/** Runs in Windows PowerShell 5.1/.NET Framework. No downloads or cloud speech APIs. */
export const windowsSpeechScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Web.Extensions
$source = @"
using System;
using System.Collections.Generic;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Web.Script.Serialization;
public class LocalAssistantSpeech {
  static SpeechRecognitionEngine engine;
  static SpeechSynthesizer speaker;
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static object sync = new object();
  static string spoken = "";
  static DateTime speakingUntil = DateTime.MinValue;
  static void Emit(string type, string text) {
    lock(sync) { Console.WriteLine(json.Serialize(new { type = type, text = text })); Console.Out.Flush(); }
  }
  public static void Run(string name) {
    var installed = SpeechRecognitionEngine.InstalledRecognizers();
    if (installed.Count == 0) throw new Exception("No offline Windows speech recognizer installed. Install a Windows speech language pack.");
    var selected = installed[0];
    foreach (var item in installed) if (item.Culture.Name.StartsWith("en")) { selected = item; break; }
    engine = new SpeechRecognitionEngine(selected);
    var words = new List<string>();
    var commands = new [] { "stop", "cancel", "abort", "pause", "can you hear me", "are you listening", "take screenshot", "start screen recording", "stop screen recording", "open settings", "toggle microphone", "mute microphone", "minimize sidebar", "clear conversation", "what time is it" };
    foreach (var command in commands) { words.Add(command); words.Add(name + " " + command); }
    words.Add(name);
    var builder = new GrammarBuilder(new Choices(words.ToArray()));
    builder.Culture = selected.Culture;
    var controls = new Grammar(builder); controls.Priority = 10; controls.Name = "controls";
    engine.LoadGrammar(controls);
    engine.LoadGrammar(new DictationGrammar());
    engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(200);
    engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(350);
    speaker = new SpeechSynthesizer();
    speaker.SetOutputToDefaultAudioDevice();
    engine.SpeechRecognized += (sender, e) => {
      if (e.Result.Confidence < (e.Result.Grammar.Name == "controls" ? 0.55 : 0.65)) return;
      string text = e.Result.Text;
      // Suppress direct echoes, while allowing spoken Stop to interrupt other speech.
      if (DateTime.UtcNow < speakingUntil && spoken.IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0) return;
      Emit("transcript", text);
    };
    engine.AudioStateChanged += (sender, e) => {};
    engine.RecognizeCompleted += (sender, e) => {
      if (e.Error != null) Emit("error", "Local speech recognition stopped. Check your microphone and Windows speech language pack.");
    };
    engine.SetInputToDefaultAudioDevice();
    engine.RecognizeAsync(RecognizeMode.Multiple);
    Emit("ready", selected.Culture.Name);
    string line;
    while ((line = Console.ReadLine()) != null) {
      var message = json.Deserialize<Dictionary<string, object>>(line);
      string op = message.ContainsKey("type") ? (string)message["type"] : "";
      if (op == "stop") { speaker.SpeakAsyncCancelAll(); }
      if (op == "speak") {
        spoken = (string)message["text"];
        speakingUntil = DateTime.UtcNow.AddSeconds(Math.Max(2, spoken.Length / 10));
        speaker.SpeakAsyncCancelAll();
        speaker.SpeakAsync(spoken);
      }
      if (op == "close") break;
    }
    engine.RecognizeAsyncCancel(); engine.Dispose(); speaker.Dispose();
  }
}
"@
Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Speech', 'System.Web.Extensions')
try { [LocalAssistantSpeech]::Run($env:GEMINI_WAKE_NAME) }
catch { [Console]::WriteLine('{"type":"error","text":"Offline Windows speech is unavailable. Install a Windows speech language pack and check microphone permissions."}') }
`;
