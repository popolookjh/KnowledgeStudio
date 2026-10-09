import { useState } from 'react';
import type { IntegrityReportDto } from '../../shared/ipc-contract';
import { useAppState } from '../state/store';

/**
 * Knowledge integrity: stable document identity, provenance resolution,
 * and change-feed state. Repair only assigns/renews IDs through the trusted
 * note writer; it never deletes notes or provenance.
 */
export function IntegrityPanel(): React.JSX.Element {
  const { bridge, sessionRoot } = useAppState();
  const [report, setReport] = useState<IntegrityReportDto | null>(null);
  const [message, setMessage] = useState('');

  const check = async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.integrityReport();
    if (result.ok) {
      setReport(result.value);
      setMessage('');
    } else setMessage(result.error.message);
  };
  const repair = async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.integrityRepair();
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setReport(result.value.report);
    setMessage(
      `Assigned ${result.value.assigned} IDs, renewed ${result.value.reassigned} duplicate IDs`,
    );
  };

  const needsRepair =
    report !== null && (report.missingId.length > 0 || report.duplicateIds.length > 0);
  return (
    <section
      className="rightbar__section integrity-panel"
      aria-labelledby="integrity-panel-heading"
    >
      <h3 className="rightbar__heading" id="integrity-panel-heading">
        Knowledge integrity
      </h3>
      <button
        type="button"
        className="btn btn--small"
        disabled={!sessionRoot}
        onClick={() => void check()}
      >
        Check identity &amp; provenance
      </button>
      {report && (
        <dl className="integrity-panel__report">
          <div>
            <dt>Notes with stable ID</dt>
            <dd>
              {report.withId} / {report.notes}
            </dd>
          </div>
          <div>
            <dt>Missing IDs</dt>
            <dd>{report.missingId.length}</dd>
          </div>
          <div>
            <dt>Duplicate IDs</dt>
            <dd>{report.duplicateIds.length}</dd>
          </div>
          <div>
            <dt>Invalid frontmatter</dt>
            <dd>{report.invalidFrontmatter.length}</dd>
          </div>
          <div>
            <dt>Provenance records</dt>
            <dd>
              {report.provenance.records} (
              {Object.entries(report.provenance.bySourceType)
                .map(([type, count]) => `${type} ${count}`)
                .join(', ') || 'none'}
              )
            </dd>
          </div>
          <div>
            <dt>Unresolved sources</dt>
            <dd>{report.provenance.unresolved.length}</dd>
          </div>
          <div>
            <dt>Change feed</dt>
            <dd>
              {report.changeFeed.retained} events · <code>{report.changeFeed.cursor}</code>
            </dd>
          </div>
        </dl>
      )}
      {needsRepair && (
        <button type="button" className="btn btn--small btn--primary" onClick={() => void repair()}>
          Assign missing IDs
        </button>
      )}
      <p className="rightbar__hint" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
