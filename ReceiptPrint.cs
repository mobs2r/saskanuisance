using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ReceiptPrint {
  const string Printer = "M860 USB Text Test";
  const int RowBytes = 56;                 // 448 dots
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
  static void Need(int at, int n, int length) { if (at + n > length) throw new InvalidDataException("Invalid receipt command."); }
  static void Validate(List<byte[]> chunks) {
    int total = 0;
    foreach (byte[] chunk in chunks) total += chunk.Length;
    byte[] all = new byte[total];
    int offset = 0;
    foreach (byte[] chunk in chunks) { System.Buffer.BlockCopy(chunk, 0, all, offset, chunk.Length); offset += chunk.Length; }
    if (all.Length < 2 || all[0] != 0x1b || all[1] != 0x40) throw new InvalidDataException("Invalid receipt header.");
    int p = 0;
    bool cut = false;
    while (p < all.Length) {
      byte b = all[p];
      if (b == 0x0a) { p++; continue; }
      if (b >= 0x20 && b <= 0x7e) { p++; continue; }
      if (b == 0x1b) {
        Need(p, 2, all.Length);
        byte cmd = all[p + 1];
        if (cmd == 0x40) { p += 2; continue; }
        if (cmd == 0x61 || cmd == 0x21 || cmd == 0x45 || cmd == 0x4a || cmd == 0x4d || cmd == 0x64) {
          Need(p, 3, all.Length);
          byte n = all[p + 2];
          if ((cmd == 0x61 && n > 2) || (cmd == 0x45 && n > 1) || (cmd == 0x4d && n > 1)) throw new InvalidDataException("Invalid receipt command.");
          p += 3; continue;
        }
        if (cmd == 0x37) { Need(p, 5, all.Length); p += 5; continue; }
        throw new InvalidDataException("Invalid receipt command.");
      }
      if (b == 0x1d) {
        Need(p, 2, all.Length);
        byte cmd = all[p + 1];
        if (cmd == 0x21 || cmd == 0x48 || cmd == 0x68 || cmd == 0x77) { Need(p, 3, all.Length); p += 3; continue; }
        if (cmd == 0x56) {
          Need(p, 3, all.Length);
          byte m = all[p + 2];
          if (m == 0 || m == 1 || m == 48 || m == 49) { cut = true; p += 3; continue; }
          if (m == 65 || m == 66) { Need(p, 4, all.Length); cut = true; p += 4; continue; }
          throw new InvalidDataException("Invalid receipt command.");
        }
        if (cmd == 0x76) {
          Need(p, 8, all.Length);
          if (all[p + 2] != 0x30 || all[p + 3] != 0) throw new InvalidDataException("Invalid raster header.");
          int x = all[p + 4] + all[p + 5] * 256;
          int y = all[p + 6] + all[p + 7] * 256;
          if (x != RowBytes || y < 1 || y > 64) throw new InvalidDataException("Invalid raster block.");
          int data = x * y;
          Need(p, 8 + data, all.Length);
          p += 8 + data; continue;
        }
        if (cmd == 0x6b) {
          Need(p, 4, all.Length);
          if (all[p + 2] != 73) throw new InvalidDataException("Invalid receipt command.");
          int len = all[p + 3];
          if (len < 2) throw new InvalidDataException("Invalid receipt command.");
          Need(p, 4 + len, all.Length);
          p += 4 + len; continue;
        }
        throw new InvalidDataException("Invalid receipt command.");
      }
      throw new InvalidDataException("Invalid receipt command.");
    }
    if (!cut) throw new InvalidDataException("Receipt is missing its cut.");
  }
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
        if(count < 1 || count > 41) throw new InvalidDataException("Invalid chunk count.");
        for(uint i=0;i<count;i++) {
          uint length = reader.ReadUInt32();
          if(length < 1 || length > 3784) throw new InvalidDataException("Invalid block length.");
          byte[] bytes=reader.ReadBytes((int)length);
          if(bytes.Length != length) throw new InvalidDataException("Incomplete raster data.");
          chunks.Add(bytes); total += bytes.Length;
        }
        if(reader.BaseStream.ReadByte()!=-1) throw new InvalidDataException("Unexpected trailing data.");
      }
      Validate(chunks);
      if(args[0]=="--dry-run") {
        Console.WriteLine("{\"ok\":true,\"dryRun\":true,\"printerOpened\":false,\"chunks\":"+chunks.Count+",\"bytes\":"+total+"}");
        return 0;
      }
      Check(OpenPrinter(Printer,out handle,IntPtr.Zero),"Cannot open the M860 printer.");
      var doc=new DocInfo {name="Saskatoon Transit - Proof of Payment",output=null,datatype="RAW"};
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
