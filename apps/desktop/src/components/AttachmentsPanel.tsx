import { useEffect, useState } from 'react';
import { useAppState } from '../state/store';

export function AttachmentsPanel(): React.JSX.Element {
  const { bridge, activePath } = useAppState();
  const [issues, setIssues] = useState<
    readonly { vaultPath: string; reason: 'missing' | 'orphan' }[]
  >([]);

  useEffect(() => {
    let current = true;
    if (!bridge || !activePath) {
      setIssues([]);
      return () => {
        current = false;
      };
    }
    void bridge.attachmentIssues(activePath).then((result) => {
      if (current) setIssues(result.ok ? result.value : []);
    });
    return () => {
      current = false;
    };
  }, [bridge, activePath]);

  return (
    <section className="rightbar__section" aria-labelledby="attachments-heading">
      <h3 id="attachments-heading" className="rightbar__heading">
        Attachments
      </h3>
      {issues.length === 0 ? (
        <p className="rightbar__hint">No missing or orphan attachments.</p>
      ) : (
        <ul className="rightbar__list">
          {issues.map((issue) => (
            <li key={`${issue.reason}:${issue.vaultPath}`} role="status">
              {issue.reason === 'missing' ? 'Missing' : 'Orphan'}: {issue.vaultPath}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
