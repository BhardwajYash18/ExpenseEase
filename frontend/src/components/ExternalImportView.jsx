import React, { useState, useEffect } from 'react';
import {
  IconUpload,
  IconCheckCircle,
  IconAlertTriangle,
  IconDownload,
  IconRefresh,
} from './Icons';

export default function ExternalImportView({ authToken, currentUser }) {
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Upload & preview state
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  // Commit state
  const [committing, setCommitting] = useState(false);
  const [finalizeImmediately, setFinalizeImmediately] = useState(true);

  async function fetchImports() {
    if (!authToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/finance/external-imports', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setImports(data.imports || []);
      }
    } catch {
      // quiet fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchImports();
  }, [authToken]);

  // Handle CSV upload & preview
  async function handleUploadAndPreview(e) {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    setPreviewResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/finance/external-imports/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to parse and validate CSV file');

      setPreviewResult(data);
      if (data.canCommit) {
        setSuccessMsg(`File parsed successfully: ${data.rowCount} balanced transactions ready for journal entry.`);
      } else {
        setError(`Validation detected errors in ${data.errors?.length || 0} transaction row(s).`);
      }
      fetchImports();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Handle commit to journal entry
  async function handleCommitImport() {
    if (!previewResult || !previewResult.importId) return;

    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/external-imports/${previewResult.importId}/commit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ finalizeImmediately }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to post transactions to journal entry');

      setSuccessMsg(
        `Transactions posted successfully to GL Journal Entry #${data.journalEntryId.slice(0, 8)} (${data.journalEntryStatus}).`
      );
      setPreviewResult(null);
      setSelectedFile(null);
      fetchImports();
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  }

  // Download sample CSV template
  function handleDownloadSample() {
    const sampleCsv =
      `Date,Account,Description,Debit,Credit\n` +
      `2026-10-15,6001 - Office Supplies,Staples corporate office restocking,145.50,0.00\n` +
      `2026-10-15,2000 - Accounts Payable,Vendor invoice payable - Staples,0.00,145.50\n` +
      `2026-10-20,6004 - Meals & Entertainment,Client working dinner catering,320.00,0.00\n` +
      `2026-10-20,2000 - Accounts Payable,Vendor invoice payable - Bistro,0.00,320.00\n`;

    const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_financial_import.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Notifications */}
      {error && (
        <div className="alert alert-danger" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      {/* CSV Upload & Validation Card */}
      <div className="table-card">
        <div className="table-header-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <span className="table-title">External Financial Data Import</span>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Upload external transaction files (CSV), validate double-entry balances, and post into GL Journal Entries.
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleDownloadSample}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconDownload size={13} /> Download Sample CSV
          </button>
        </div>

        <form onSubmit={handleUploadAndPreview} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="file"
              accept=".csv,text/csv"
              className="form-input"
              style={{ width: 'auto', flex: 1, minWidth: '260px' }}
              onChange={(e) => {
                if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
              }}
              required
            />
            <button
              type="submit"
              className="btn btn-gold btn-sm"
              disabled={uploading || !selectedFile}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <IconUpload size={14} />
              {uploading ? 'Validating CSV...' : 'Upload & Validate CSV'}
            </button>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            Supported columns: <strong>Date (YYYY-MM-DD), Account, Description, Debit, Credit</strong>. Transactions must balance (Total Debits = Total Credits).
          </div>
        </form>

        {/* Validation & Preview Summary */}
        {previewResult && (
          <div style={{ padding: '18px 20px', background: '#f8fafc', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  File Validation Summary: {previewResult.originalFilename}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {previewResult.rowCount} total transaction rows parsed
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Debit / Credit Totals:</div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                    Debits: ${Number(previewResult.totalDebit).toFixed(2)} | Credits: ${Number(previewResult.totalCredit).toFixed(2)}
                  </div>
                </div>

                <span className={`status-pill ${previewResult.isBalanced ? 'approved' : 'rejected'}`}>
                  {previewResult.isBalanced ? 'BALANCED' : 'IMBALANCED'}
                </span>
              </div>
            </div>

            {/* Validation Errors If Any */}
            {previewResult.errors && previewResult.errors.length > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: '4px', marginBottom: '14px', fontSize: '0.775rem', color: '#991b1b' }}>
                <strong>Validation Warnings:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {previewResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Transaction Preview Table */}
            {previewResult.previewRows && previewResult.previewRows.length > 0 && (
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '4px', background: '#ffffff', marginBottom: '14px' }}>
                <table style={{ width: '100%', fontSize: '0.775rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'center', width: '40px' }}>#</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Account</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Description</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>Debit</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.previewRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text-muted)' }}>{r.lineNumber}</td>
                        <td style={{ padding: '6px 10px' }}>{r.date}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.account}</td>
                        <td style={{ padding: '6px 10px' }}>{r.description}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: Number(r.debitAmount) > 0 ? 600 : 'normal' }}>
                          {Number(r.debitAmount) > 0 ? `$${Number(r.debitAmount).toFixed(2)}` : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: Number(r.creditAmount) > 0 ? 600 : 'normal' }}>
                          {Number(r.creditAmount) > 0 ? `$${Number(r.creditAmount).toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Commit Controls */}
            {previewResult.canCommit && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={finalizeImmediately}
                    onChange={(e) => setFinalizeImmediately(e.target.checked)}
                  />
                  <span>Finalize Journal Entry Immediately (Since Double-Entry Balance is Validated)</span>
                </label>

                <button
                  type="button"
                  className="btn btn-gold btn-sm"
                  onClick={handleCommitImport}
                  disabled={committing}
                >
                  {committing ? 'Posting to GL...' : 'Confirm & Post to Journal Entry'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Import History Table */}
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px' }}>
            External Import History
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Loading import history...</div>
          ) : imports.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No external financial files imported yet.
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Uploaded</th>
                    <th>Filename</th>
                    <th style={{ textAlign: 'center' }}>Rows</th>
                    <th style={{ textAlign: 'right' }}>Total Debit</th>
                    <th style={{ textAlign: 'right' }}>Total Credit</th>
                    <th style={{ textAlign: 'center' }}>Import Status</th>
                    <th>Journal Entry</th>
                    <th>Uploaded By</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp) => (
                    <tr key={imp.id}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {new Date(imp.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ fontWeight: 600 }}>{imp.originalFilename}</td>
                      <td style={{ textAlign: 'center' }}>{imp.rowCount}</td>
                      <td style={{ textAlign: 'right' }}>${Number(imp.totalDebit).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>${Number(imp.totalCredit).toFixed(2)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`status-pill ${imp.status === 'POSTED' ? 'approved' : 'pending'}`} style={{ fontSize: '0.7rem' }}>
                          {imp.status}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.75rem' }}>
                        {imp.journalEntryId ? (
                          <span style={{ color: 'var(--gold-primary)', fontWeight: 600 }}>
                            #{imp.journalEntryId.slice(0, 8)} ({imp.journalEntryStatus || 'GL'})
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{imp.uploadedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
