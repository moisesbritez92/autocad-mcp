using System;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using Autodesk.AutoCAD.ApplicationServices;
using Newtonsoft.Json;
using System.IO;

namespace AutoCAD.MCP.Plugin
{
    public class HttpServer
    {
        private readonly HttpListener _listener;
        private bool _isRunning;
        private readonly CommandProcessor _processor;

        public HttpServer(string prefix)
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add(prefix);
            _processor = new CommandProcessor();
        }

        public void Start()
        {
            if (_isRunning) return;
            _listener.Start();
            _isRunning = true;
            Task.Run(() => HandleIncomingConnections());
        }

        public void Stop()
        {
            _isRunning = false;
            _listener.Stop();
            _listener.Close();
        }

        private async Task HandleIncomingConnections()
        {
            while (_isRunning)
            {
                try
                {
                    var ctx = await _listener.GetContextAsync();
                    ProcessRequest(ctx);
                }
                catch (HttpListenerException)
                {
                    // Listener stopped
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine(ex.Message);
                }
            }
        }

        private async void ProcessRequest(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var resp = ctx.Response;

            try
            {
                if (req.HttpMethod != "POST")
                {
                    resp.StatusCode = 405;
                    resp.Close();
                    return;
                }

                // Verify Token
                string authHeader = req.Headers["Authorization"] ?? "";
                string expectedToken = Environment.GetEnvironmentVariable("MCP_AUTOCAD_TOKEN", EnvironmentVariableTarget.User) ?? "default-secret-token";
                
                if (!authHeader.StartsWith("Bearer ") || authHeader.Substring(7) != expectedToken)
                {
                     resp.StatusCode = 401;
                     WriteResponse(resp, new { error = "Unauthorized" });
                     return;
                }

                using (var reader = new StreamReader(req.InputStream, req.ContentEncoding))
                {
                    var body = await reader.ReadToEndAsync();
                    var commandRequest = JsonConvert.DeserializeObject<McpCommandRequest>(body);
                    
                    if (commandRequest == null)
                    {
                        resp.StatusCode = 400;
                        WriteResponse(resp, new { error = "Invalid JSON" });
                        return;
                    }

                    // Execute on Main Thread
                    var result = await ExecuteOnMainThread(() => _processor.Process(commandRequest));
                    
                    WriteResponse(resp, result);
                }
            }
            catch (Exception ex)
            {
                resp.StatusCode = 500;
                WriteResponse(resp, new { error = ex.Message, stack = ex.StackTrace });
            }
        }

        private void WriteResponse(HttpListenerResponse resp, object data)
        {
            var json = JsonConvert.SerializeObject(data);
            var buffer = Encoding.UTF8.GetBytes(json);
            resp.ContentLength64 = buffer.Length;
            resp.ContentType = "application/json";
            resp.OutputStream.Write(buffer, 0, buffer.Length);
            resp.Close();
        }

        // Helper to run code on AutoCAD main thread
        // Correct pattern: use Application.DocumentManager.ExecuteInCommandContextAsync
        // which queues work on AutoCAD's main execution thread and awaits the result.
        private Task<object> ExecuteOnMainThread(Func<object> action)
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);

            // ExecuteInCommandContextAsync marshals the delegate to AutoCAD's main command thread.
            // This is the supported API for calling AutoCAD database operations from a background thread.
            Application.DocumentManager.ExecuteInCommandContextAsync(async (unused) =>
            {
                await Task.Yield(); // yield to ensure we are truly on the command context thread
                try
                {
                    var doc = Application.DocumentManager.MdiActiveDocument;
                    if (doc == null)
                    {
                        tcs.SetException(new InvalidOperationException("No active AutoCAD document."));
                        return;
                    }

                    using (doc.LockDocument())
                    {
                        var result = action();
                        tcs.SetResult(result);
                    }
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                }
            }, null);

            return tcs.Task;
        }
    }

    public class McpCommandRequest
    {
        public string Command { get; set; } = "";
        public System.Collections.Generic.Dictionary<string, object>? Args { get; set; }
    }
}
