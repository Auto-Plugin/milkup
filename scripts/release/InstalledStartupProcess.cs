// Byte-stream capture without PowerShell's line/event redirection adapter.
// Diagnostic capture only; no window/input/IPC or application policy changes.
using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

public sealed class InstalledStartupProcess : IDisposable {
    public Process Product { get; private set; }
    public long StdoutBytes { get; private set; }
    public long StderrBytes { get; private set; }
    public bool StdoutEof { get; private set; }
    public bool StderrEof { get; private set; }
    public bool Overflow { get; private set; }
    Task stdoutTask, stderrTask;
    const long Limit = 1024 * 1024;

    public static InstalledStartupProcess Start(string image, string document, IDictionary environment, string stdout, string stderr) {
        var capture = new InstalledStartupProcess();
        var outFile = new FileStream(stdout, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 16384, true);
        FileStream errFile = null;
        try {
            errFile = new FileStream(stderr, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 16384, true);
            var info = new ProcessStartInfo(image) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true };
            info.ArgumentList.Add(document);
            foreach (DictionaryEntry item in environment) info.Environment[(string)item.Key] = (string)item.Value;
            capture.Product = new Process { StartInfo = info };
            if (!capture.Product.Start()) throw new InvalidOperationException("Installed process start failed");
            capture.stdoutTask = capture.Copy(capture.Product.StandardOutput.BaseStream, outFile, false);
            capture.stderrTask = capture.Copy(capture.Product.StandardError.BaseStream, errFile, true);
            return capture;
        } catch { outFile.Dispose(); if (errFile != null) errFile.Dispose(); throw; }
    }
    async Task Copy(Stream input, FileStream output, bool error) {
        try {
            var buffer = new byte[16384]; long total = 0;
            while (true) {
                int count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (count == 0) break;
                total += count;
                if (total > Limit) { Overflow = true; throw new InvalidOperationException("Startup capture exceeded its bounded budget"); }
                await output.WriteAsync(buffer, 0, count).ConfigureAwait(false);
                await output.FlushAsync().ConfigureAwait(false);
                if (error) StderrBytes = total; else StdoutBytes = total;
            }
            if (error) StderrEof = true; else StdoutEof = true;
        } finally { output.Dispose(); }
    }
    public bool Drain(int milliseconds) {
        return Task.WhenAll(stdoutTask, stderrTask).Wait(milliseconds) && StdoutEof && StderrEof && !Overflow;
    }
    public void Dispose() { if (Product != null) Product.Dispose(); }
}
