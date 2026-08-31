import { store, useAppState } from '../state/store';

/** Shown when no vault is open: open / create / reconnect actions. */
export function WelcomeView(): React.JSX.Element {
  const { sessionRoot, bootstrapped, bridge } = useAppState();
  if (sessionRoot) {
    return <></>;
  }
  return (
    <div className="welcome">
      <h1>Knowledge Studio</h1>
      <p className="welcome__tagline">
        Your notes stay in plain Markdown files you own — this app is a window onto them.
      </p>
      {!bridge && (
        <p className="welcome__warning">
          Running outside the desktop shell: vault actions are unavailable in this preview.
        </p>
      )}
      <div className="welcome__actions">
        <button type="button" className="btn btn--primary" onClick={() => void store.pickVault()}>
          Open a vault…
        </button>
        <button type="button" className="btn" onClick={() => void store.createVault()}>
          Create a new vault…
        </button>
      </div>
      {!bootstrapped && <p className="welcome__hint">Starting…</p>}
    </div>
  );
}
