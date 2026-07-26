import { useEffect, useState } from "react";
import {
  getProviderDiagnostics,
  getProviderSettings,
  setProviderSettings,
  testOpenAiConnectivity,
  type ProviderDiagnostics,
  type ProviderSettings,
} from "../core/developer/developerServices";

const defaults: ProviderSettings = {
  provider: "local",
  openaiModel: "gpt-5.4",
  localModelPath: "",
};

export default function SettingsRoute() {
  const [settings, setSettings] = useState(defaults);
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setSettings(await getProviderSettings());
    setDiagnostics(await getProviderDiagnostics());
  };

  useEffect(() => {
    void refresh().catch((error) => setMessage(String(error)));
  }, []);

  const save = async () => {
    await setProviderSettings(settings);
    await refresh();
    setMessage("Provider settings saved. No credential value was stored.");
  };

  const testConnection = async () => {
    setMessage("Testing explicit provider connectivity…");
    try {
      if (settings.provider === "openai") {
        const result = await testOpenAiConnectivity(settings.openaiModel);
        setMessage(`Connectivity ${result.state}: ${result.diagnostic}`);
      } else {
        const current = await getProviderDiagnostics();
        if (!current.real) throw new Error(current.message);
        setMessage(`Provider is available: ${current.message}`);
      }
    } catch (error) {
      setMessage(`Connectivity failed: ${String(error)}`);
    }
  };

  return (
    <main className="settings-route">
      <h1>Provider Settings</h1>
      <p>Credentials remain in the shared Rust backend boundary and are never returned to this page.</p>
      <label>
        Active provider
        <select
          value={settings.provider}
          onChange={(event) =>
            setSettings({ ...settings, provider: event.target.value as ProviderSettings["provider"] })
          }
        >
          <option value="local">Local model</option>
          <option value="openai">OpenAI</option>
          <option value="mock">Mock — non-applyable</option>
        </select>
      </label>
      <label>
        OpenAI model
        <input
          value={settings.openaiModel}
          onChange={(event) => setSettings({ ...settings, openaiModel: event.target.value })}
        />
      </label>
      <label>
        Local GGUF path
        <input
          value={settings.localModelPath}
          onChange={(event) => setSettings({ ...settings, localModelPath: event.target.value })}
        />
      </label>
      <div className="developer-actions">
        <button type="button" onClick={() => void save()}>Save settings</button>
        <button type="button" onClick={() => void testConnection()}>Test connectivity</button>
      </div>
      {diagnostics && (
        <dl>
          <dt>Provider</dt><dd>{diagnostics.provider}</dd>
          <dt>State</dt><dd>{diagnostics.state}</dd>
          <dt>Backend credential</dt><dd>{diagnostics.credentialAvailable ? "Available" : "Unavailable"}</dd>
          <dt>Model</dt><dd>{diagnostics.model}</dd>
          <dt>Local model</dt><dd>{diagnostics.localModelAvailable ? "Available" : "Unavailable"}</dd>
          <dt>Diagnostic</dt><dd>{diagnostics.message}</dd>
        </dl>
      )}
      <p>{message}</p>
    </main>
  );
}
