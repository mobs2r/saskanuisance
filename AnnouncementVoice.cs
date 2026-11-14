using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Speech.Synthesis;
using System.Web.Script.Serialization;
using System.Collections.Generic;
class AnnouncementVoice {
 static JavaScriptSerializer json=new JavaScriptSerializer();
 static void Reply(object value){Console.WriteLine(json.Serialize(value));}
 static int Main(){
  Console.InputEncoding=Encoding.UTF8;Console.OutputEncoding=new UTF8Encoding(false);
  try {
   char[] input=new char[4097];int length=0,n;while((n=Console.In.Read(input,length,input.Length-length))>0){length+=n;if(length==input.Length)throw new Exception("Input too long");}
   var payload=json.Deserialize<Dictionary<string,string>>(new string(input,0,length));string mode=payload.ContainsKey("mode")?payload["mode"]:"";
   using(var voice=new SpeechSynthesizer()){
    var voices=voice.GetInstalledVoices().Where(v=>v.Enabled).Select(v=>v.VoiceInfo).ToList();
    var selected=voices.FirstOrDefault(v=>v.Name=="Microsoft Zira Desktop")??voices.FirstOrDefault(v=>v.Culture.Name.StartsWith("en-"));
    if(selected==null)throw new Exception("No English voice");voice.SelectVoice(selected.Name);voice.Rate=-1;voice.Volume=70;long bytes=0;
    if(mode=="speak"||mode=="dry-run"){
     string text=payload.ContainsKey("text")?payload["text"]:null;if(String.IsNullOrWhiteSpace(text)||text.Length>240)throw new Exception("Invalid text");
     if(mode=="dry-run"){using(var stream=new MemoryStream()){voice.SetOutputToWaveStream(stream);voice.Speak(text);bytes=stream.Length;voice.SetOutputToNull();}}
     else voice.Speak(text);
    } else if(mode!="status")throw new Exception("Invalid mode");
    Reply(new{available=true,voice=selected.Name,bytes=bytes});return 0;
   }
  }catch{Reply(new{available=false,error="Windows speech unavailable"});return 1;}
 }
}
