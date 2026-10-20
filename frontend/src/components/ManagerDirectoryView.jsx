import React, { useState, useEffect } from 'react';
import {
  IconUsers,
  IconUser,
  IconPlus,
  IconSearch,
  IconRefresh,
  IconShield,
  IconCheckCircle,
  IconBuilding,
  IconClock,
  IconLock,
  IconX,
  IconCopy,
  IconCheck,
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
} from './Icons';

export default function ManagerDirectoryView({ authToken, currentUser }) {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Search, filter, and sorting states
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState('date_desc'); // 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'email_asc'
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ACTIVE'

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal states for adding a new manager
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addSuccess, setAddSuccess] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Fetch managers from backend
  async function fetchManagers() {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/managers', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to load manager directory');
      }
      setManagers(data.managers || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchManagers();
  }, [authToken]);

  // Handle Add Manager submission
  async function handleAddManager(e) {
    e.preventDefault();
    setAddLoading(true);
    setAddError(null);
    setAddSuccess(null);

    // Basic frontend validations
    if (!addForm.firstName.trim() || !addForm.lastName.trim()) {
      setAddError('First name and last name are required');
      setAddLoading(false);
      return;
    }
    if (!addForm.email.trim() || !addForm.email.includes('@')) {
      setAddError('Please enter a valid email address');
      setAddLoading(false);
      return;
    }
    if (!addForm.password || addForm.password.length < 6) {
      setAddError('Password must be at least 6 characters long');
      setAddLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/managers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          firstName: addForm.firstName.trim(),
          lastName: addForm.lastName.trim(),
          email: addForm.email.trim().toLowerCase(),
          password: addForm.password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to provision new manager');
      }

      setAddSuccess(`Manager ${data.manager?.fullName || data.manager?.email} created successfully!`);
      setAddForm({ firstName: '', lastName: '', email: '', password: '' });
      fetchManagers();

      // Auto close modal after brief delay
      setTimeout(() => {
        setShowAddModal(false);
        setAddSuccess(null);
      }, 1600);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  }

  const handleCopyEmail = (email, id) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(email);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Filter managers by search and status
  const filteredManagers = managers.filter((m) => {
    if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;

    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      const name = `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase();
      const email = (m.email || '').toLowerCase();
      const id = (m.id || '').toLowerCase();
      return name.includes(q) || email.includes(q) || id.includes(q);
    }
    return true;
  });

  // Sort managers
  const sortedManagers = [...filteredManagers].sort((a, b) => {
    if (sortBy === 'name_asc') {
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
      return nameA.localeCompare(nameB);
    }
    if (sortBy === 'name_desc') {
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
      return nameB.localeCompare(nameA);
    }
    if (sortBy === 'email_asc') {
      return (a.email || '').localeCompare(b.email || '');
    }
    if (sortBy === 'date_asc') {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    }
    // Default: 'date_desc'
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  // Pagination slice
  const totalItems = sortedManagers.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const paginatedManagers = sortedManagers.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header Card */}
      <div
        className="table-card"
        style={{
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--gold-bg-subtle)',
                color: 'var(--gold-primary)',
              }}
            >
              <IconUsers size={22} />
            </span>
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                Manager Directory &amp; Governance
              </h2>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  marginTop: '2px',
                  marginBottom: 0,
                }}
              >
                Inspect other company managers, maintain reviewer coverage, and provision new managers.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={fetchManagers}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Refresh Directory"
          >
            <IconRefresh size={14} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            className="btn btn-gold btn-sm"
            onClick={() => {
              setAddError(null);
              setAddSuccess(null);
              setShowAddModal(true);
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
            id="btn-add-manager"
          >
            <IconPlus size={15} />
            <span>Add New Manager</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Total Managers</span>
            <span className="stat-icon"><IconUsers size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{managers.length}</div>
            <span className="stat-subtext status-pill approved">In Organization</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Active Reviewers</span>
            <span className="stat-icon"><IconCheckCircle size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">
              {managers.filter((m) => m.status === 'ACTIVE').length}
            </div>
            <span className="stat-subtext status-pill policy-pass">Ready for Approvals</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Security Isolation</span>
            <span className="stat-icon"><IconShield size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value" style={{ fontSize: '1.2rem' }}>PostgreSQL RLS</div>
            <span className="stat-subtext status-pill draft">Tenant Isolated</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Your Current Account</span>
            <span className="stat-icon"><IconUser size={20} /></span>
          </div>
          <div className="stat-body">
            <div
              className="stat-value"
              style={{ fontSize: '0.95rem', wordBreak: 'break-all', fontWeight: 600 }}
              title={currentUser?.email}
            >
              {currentUser?.email || 'Logged In'}
            </div>
            <span className="stat-subtext status-pill approved">Manager Access</span>
          </div>
        </div>
      </div>

      {/* Directory Table Card with Search & Sort */}
      <div className="table-card">
        {/* Search & Sort Header Controls */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            backgroundColor: '#ffffff',
          }}
        >
          {/* Search Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 280px', maxWidth: '420px' }}>
            <div className="search-box" style={{ width: '100%' }}>
              <span className="search-icon"><IconSearch size={15} /></span>
              <input
                type="text"
                className="search-input"
                placeholder="Search by manager name, email, or ID..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setCurrentPage(1);
                }}
                id="search-managers-input"
              />
            </div>
            {searchText && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setSearchText('');
                  setCurrentPage(1);
                }}
                title="Clear search"
                style={{ padding: '6px 8px' }}
              >
                <IconX size={13} />
              </button>
            )}
          </div>

          {/* Sort & Status Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Sort:
              </span>
              <select
                className="form-select"
                style={{ padding: '6px 12px', fontSize: '0.8125rem', width: 'auto', minWidth: '180px' }}
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setCurrentPage(1);
                }}
                id="sort-managers-select"
              >
                <option value="date_desc">Added Date: Newest First</option>
                <option value="date_asc">Added Date: Oldest First</option>
                <option value="name_asc">Name: A to Z</option>
                <option value="name_desc">Name: Z to A</option>
                <option value="email_asc">Email: A to Z</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Status:
              </span>
              <select
                className="form-select"
                style={{ padding: '6px 12px', fontSize: '0.8125rem', width: 'auto' }}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
              >
                <option value="ALL">All ({managers.length})</option>
                <option value="ACTIVE">Active Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="alert alert-danger" style={{ margin: '16px 20px' }}>
            <IconAlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Managers Data Table */}
        {paginatedManagers.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ marginBottom: '12px' }}><IconUsers size={40} color="var(--border-strong)" /></div>
            <h4 style={{ fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
              No Managers Found
            </h4>
            <p style={{ fontSize: '0.875rem', maxWidth: '380px', margin: '0 auto 16px auto' }}>
              {searchText
                ? `No managers match your query "${searchText}". Try resetting filters or clearing your search.`
                : 'No managers available in your organization directory.'}
            </p>
            {searchText ? (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSearchText('')}
              >
                Clear Search Filter
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-gold btn-sm"
                onClick={() => setShowAddModal(true)}
              >
                + Add First Manager
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Manager Name</th>
                    <th>Email Address</th>
                    <th>Assigned Role</th>
                    <th>Account Status</th>
                    <th>Date Added</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedManagers.map((m) => {
                    const isSelf = currentUser?.id && m.id === currentUser.id;
                    const initials = (
                      (m.firstName?.[0] || '') + (m.lastName?.[0] || m.email?.[0] || 'M')
                    ).toUpperCase();

                    return (
                      <tr key={m.id} style={{ backgroundColor: isSelf ? '#fdfbf7' : 'inherit' }}>
                        {/* Manager Avatar & Name */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                backgroundColor: isSelf ? 'var(--gold-primary)' : '#1e293b',
                                color: isSelf ? '#0f172a' : '#f8fafc',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                flexShrink: 0,
                                border: isSelf ? '2px solid var(--gold-hover)' : '1px solid var(--border-subtle)',
                              }}
                            >
                              {initials}
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                  {m.fullName || `${m.firstName} ${m.lastName}`}
                                </span>
                                {isSelf && (
                                  <span
                                    style={{
                                      fontSize: '0.65rem',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      backgroundColor: 'var(--gold-bg-subtle)',
                                      color: 'var(--gold-hover)',
                                      fontWeight: 700,
                                      border: '1px solid var(--gold-border)',
                                    }}
                                  >
                                    You
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                ID: {(m.id || '').slice(0, 8)}...
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Email */}
                        <td>
                          <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {m.email}
                          </span>
                        </td>

                        {/* Role */}
                        <td>
                          <span
                            className="status-pill draft"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontWeight: 600,
                            }}
                          >
                            <IconShield size={12} />
                            <span>{m.role || 'MANAGER'}</span>
                          </span>
                        </td>

                        {/* Status */}
                        <td>
                          <span
                            className={`status-pill ${
                              m.status === 'ACTIVE' ? 'approved' : 'rejected'
                            }`}
                          >
                            <span className="status-dot"></span>
                            <span>{m.status || 'ACTIVE'}</span>
                          </span>
                        </td>

                        {/* Created At */}
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <IconClock size={12} color="var(--text-muted)" />
                            {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : 'N/A'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => handleCopyEmail(m.email, m.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
                            title="Copy Manager Email"
                          >
                            {copiedId === m.id ? (
                              <>
                                <IconCheck size={12} color="#10b981" />
                                <span style={{ color: '#10b981' }}>Copied</span>
                              </>
                            ) : (
                              <>
                                <IconCopy size={12} />
                                <span>Copy Email</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalItems > 0 && (
              <div
                style={{
                  padding: '12px 20px',
                  borderTop: '1px solid var(--border-subtle)',
                  background: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <span>
                  Showing {(safePage - 1) * pageSize + 1} to{' '}
                  {Math.min(safePage * pageSize, totalItems)} of {totalItems} managers
                </span>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      background: '#ffffff',
                    }}
                  >
                    <option value={5}>5 per page</option>
                    <option value={10}>10 per page</option>
                    <option value={20}>20 per page</option>
                  </select>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <IconChevronLeft size={11} /> Prev
                  </button>
                  <span>
                    Page {safePage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <IconChevronRight size={11} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modern Add New Manager Modal Dialog */}
      {showAddModal && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !addLoading) setShowAddModal(false);
          }}
        >
          <div
            className="table-card"
            style={{
              width: '100%',
              maxWidth: '520px',
              padding: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--gold-bg-subtle)',
                    color: 'var(--gold-primary)',
                  }}
                >
                  <IconUsers size={20} />
                </span>
                <div>
                  <h3
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      margin: 0,
                    }}
                  >
                    Add New Manager
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                    Provision a peer manager for your company tenant
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowAddModal(false)}
                disabled={addLoading}
                style={{ padding: '6px', borderRadius: '50%' }}
                aria-label="Close Modal"
              >
                <IconX size={15} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleAddManager} style={{ padding: '24px' }}>
              {addError && (
                <div className="alert alert-danger" style={{ marginBottom: '16px' }}>
                  <IconAlertTriangle size={15} />
                  <span>{addError}</span>
                </div>
              )}

              {addSuccess && (
                <div className="alert alert-success" style={{ marginBottom: '16px' }}>
                  <IconCheckCircle size={15} />
                  <span>{addSuccess}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <div className="form-group" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                    First Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Sarah"
                    value={addForm.firstName}
                    onChange={(e) => setAddForm({ ...addForm, firstName: e.target.value })}
                    required
                    disabled={addLoading}
                    id="input-new-manager-firstname"
                  />
                </div>

                <div className="form-group" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                    Last Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Connor"
                    value={addForm.lastName}
                    onChange={(e) => setAddForm({ ...addForm, lastName: e.target.value })}
                    required
                    disabled={addLoading}
                    id="input-new-manager-lastname"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                  Email Address <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="e.g. sarah.connor@company.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  required
                  disabled={addLoading}
                  id="input-new-manager-email"
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                  The email will serve as the manager's unique login ID within this tenant.
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                  Initial Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Minimum 6 characters"
                    value={addForm.password}
                    onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    required
                    minLength={6}
                    disabled={addLoading}
                    id="input-new-manager-password"
                    style={{ paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: 0,
                    }}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <IconEye size={16} />
                  </button>
                </div>
              </div>

              {/* Informational Governance Notice */}
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <IconShield size={16} color="var(--gold-hover)" style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <strong>Role-Based Privileges:</strong> The new manager will have immediate authority
                  to review submitted expenses, inspect receipts, and approve or reject team claims within your tenant.
                </div>
              </div>

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowAddModal(false)}
                  disabled={addLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-gold btn-sm"
                  disabled={addLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                  id="btn-submit-new-manager"
                >
                  {addLoading ? (
                    <>
                      <IconRefresh size={14} className="spin" />
                      <span>Creating Manager...</span>
                    </>
                  ) : (
                    <>
                      <IconPlus size={14} />
                      <span>Create Manager</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
