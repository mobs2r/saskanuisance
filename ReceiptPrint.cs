using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ReceiptPrint {
  const string Printer = "M860 USB Text Test";
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DocInfo { [MarshalAs(UnmanagedType.LPWStr)] public string name; [MarshalAs(UnmanagedType.LPWStr)] public string output; [MarshalAs(UnmanagedType.LPWStr)] public string datatype; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] static extern int StartDocPrinter(IntPtr handle, int level, ref DocInfo doc);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr handle, byte[] bytes, int length, out int written);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool AbortPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
  static string Escape(string text) { return text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
  static void Check(bool success, string step) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), step); }
  static bool Equal(byte[] left, byte[] right) { if (left.Length != right.Length) return false; for(int i=0;i<left.Length;i++) if(left[i]!=right[i]) return false; return true; }
  [DllImport("cfgmgr32.dll", EntryPoint="CM_Locate_DevNodeW", CharSet=CharSet.Unicode)] static extern uint LocateNode(out uint node, string instance, uint flags);
  [DllImport("cfgmgr32.dll")] static extern uint CM_Get_DevNode_Status(out uint status, out uint problem, uint node, uint flags);
  static int ConnectionStatus() {
    uint node, flags, problem;
    uint result=LocateNode(out node,@"USBPRINT\YAEN80PRINTER\7&1CBD135B&0&USB001",0);
    if(result==13) { Console.WriteLine("{\"ok\":true,\"connection\":\"disconnected\",\"devicePresent\":false}"); return 0; }
    if(result!=0) { Console.WriteLine("{\"ok\":true,\"connection\":\"unknown\",\"reason\":\"Device presence could not be checked.\"}"); return 0; }
    result=CM_Get_DevNode_Status(out flags,out problem,node,0);
    string state=result==0 && problem==0 && (flags&8)!=0 ? "connected" : "unknown";
    Console.WriteLine("{\"ok\":true,\"connection\":\""+state+"\",\"devicePresent\":true,\"problem\":"+problem+"}"); return 0;
  }
  public static int Main(string[] args) {
    if(args.Length==1 && args[0]=="--status") { try { return ConnectionStatus(); } catch { Console.WriteLine("{\"ok\":true,\"connection\":\"unknown\"}"); return 0; } }
    bool started = false, completed = false;
    IntPtr handle = IntPtr.Zero;
    try {
      if(args.Length != 1 || (args[0] != "--dry-run" && args[0] != "--print")) throw new ArgumentException("Select --dry-run or --print.");
      var chunks = new List<byte[]>();
      int total = 0;
      using(var reader = new BinaryReader(Console.OpenStandardInput())) {
        if(reader.ReadUInt32() != 0x31504D53) throw new InvalidDataException("Invalid sample payload.");
        uint count = reader.ReadUInt32();
        if(count < 3 || count > 41) throw new InvalidDataException("Invalid chunk count.");
        for(uint i=0;i<count;i++) {
          uint length = reader.ReadUInt32();
          if(length < 1 || length > 3784) throw new InvalidDataException("Invalid block length.");
          byte[] bytes=reader.ReadBytes((int)length);
          if(bytes.Length != length) throw new InvalidDataException("Incomplete raster data.");
          chunks.Add(bytes); total += bytes.Length;
        }
        if(reader.BaseStream.ReadByte()!=-1) throw new InvalidDataException("Unexpected trailing data.");
      }
      if(!Equal(chunks[0],new byte[]{0x1b,0x40,0x1b,0x61,0,0x1b,0x4a,32}) || !Equal(chunks[chunks.Count-1],new byte[]{0x1b,0x4a,64})) throw new InvalidDataException("Invalid receipt framing.");
      int expectedWidth=chunks[1].Length>=8 ? chunks[1][4] : 0;
      for(int i=1;i<chunks.Count-1;i++) {
        byte[] c=chunks[i];
        if(c.Length<8 || c[0]!=0x1d || c[1]!=0x76 || c[2]!=0x30 || c[3]!=0 || (c[4]!=59 && c[4]!=49 && c[4]!=52 && c[4]!=56) || c[4]!=expectedWidth || c[5]!=0) throw new InvalidDataException("Invalid raster header.");
        int rows=c[6]+256*c[7];
        if(rows<1 || rows>64 || c.Length!=8+expectedWidth*rows) throw new InvalidDataException("Invalid raster block.");
      }
      if(args[0]=="--dry-run") {
        Console.WriteLine("{\"ok\":true,\"dryRun\":true,\"printerOpened\":false,\"chunks\":"+chunks.Count+",\"bytes\":"+total+"}");
        return 0;
      }
      Check(OpenPrinter(Printer,out handle,IntPtr.Zero),"Cannot open the M860 printer.");
      var doc=new DocInfo {name="SAMPLE - NOT VALID (one receipt)",output=null,datatype="RAW"};
      int job=StartDocPrinter(handle,1,ref doc);
      Check(job>0,"Cannot start a print job.");
      started=true;
      Check(StartPagePrinter(handle),"Cannot start the receipt page.");
      foreach(byte[] chunk in chunks) {
        int written;
        Check(WritePrinter(handle,chunk,chunk.Length,out written),"Printer did not accept a receipt block.");
        if(written!=chunk.Length) throw new IOException("Printer accepted only part of a receipt block.");
        Thread.Sleep(150);
      }
      Check(EndPagePrinter(handle),"Cannot finish the receipt page.");
      Check(EndDocPrinter(handle),"Cannot finish the print job.");
      completed=true;
      Console.WriteLine("{\"ok\":true,\"submitted\":true,\"jobId\":"+job+",\"bytes\":"+total+"}");
      return 0;
    } catch(Exception error) {
      Console.WriteLine("{\"ok\":false,\"message\":\""+Escape(error.Message)+"\",\"outcomeUncertain\":"+(started?"true":"false")+"}");
      return 1;
    } finally {
      if(handle!=IntPtr.Zero) {
        if(started && !completed) AbortPrinter(handle);
        ClosePrinter(handle);
      }
    }
  }
}

