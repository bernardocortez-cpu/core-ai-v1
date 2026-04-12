import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import "./MemoryModal.css";

const formatMemoryCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return new Intl.NumberFormat("en-US").format(n);
};

const MEMORY_LIMITS_BY_PLAN = {
  PRO: 1000,
  PLUS: 5000,
  PREMIUM: 5000,
  MAX: 15000,
};

function IconButton({ title, onClick, children, danger, disabled }) {
  return (
    <button
      type="button"
      className={`memory-icon-btn ${danger ? "danger" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      className={`memory-toggle ${checked ? "on" : "off"} ${disabled ? "disabled" : ""}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span className="memory-toggle-thumb" />
    </button>
  );
}

export default function MemoryModal({ open, onClose, onOpenPlan }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");

  const [editId, setEditId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("OTHER");

  const queryRef = useRef(null);
  const editTextareaRef = useRef(null);

  const fetchMemories = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/memory");
      setData(res?.data || null);
    } catch (e) {
      setError(e?.message || "Failed to load memories.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    fetchMemories().catch(() => {});
    const t = setTimeout(() => {
      try {
        queryRef.current?.focus?.();
      } catch {}
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const enabled = Boolean(data?.enabled);
  const available = Boolean(data?.available);
  const used = typeof data?.used === "number" ? data.used : items.length;
  const plan = String(data?.plan || "").toUpperCase();
  const limit =
    Number.isFinite(MEMORY_LIMITS_BY_PLAN[plan])
      ? MEMORY_LIMITS_BY_PLAN[plan]
      : typeof data?.limit === "number"
        ? data.limit
        : null;

  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => {
      const c = String(m?.content || "").toLowerCase();
      const cat = String(m?.category || "").toLowerCase();
      return c.includes(q) || cat.includes(q);
    });
  }, [items, query]);

  const beginEdit = (m) => {
    setEditId(m?.id || null);
    setEditContent(String(m?.content || ""));
    setEditCategory(String(m?.category || "OTHER"));
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditContent("");
    setEditCategory("OTHER");
  };

  useEffect(() => {
    if (!open || !editId) return;

    const focusAndScroll = () => {
      const field = editTextareaRef.current;
      if (!field) return;
      try {
        field.focus({ preventScroll: true });
      } catch {
        field.focus();
      }
      try {
        field.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      } catch {
        field.scrollIntoView();
      }
    };

    const t1 = setTimeout(focusAndScroll, 50);
    const t2 = setTimeout(focusAndScroll, 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open, editId]);

  const saveEdit = async () => {
    const id = String(editId || "");
    if (!id) return;
    const content = String(editContent || "").trim();
    if (!content) return;

    setSaving(true);
    setError("");
    try {
      await api.patch(`/memory/${encodeURIComponent(id)}`, {
        content,
        category: String(editCategory || "OTHER").toUpperCase(),
      });
      cancelEdit();
      await fetchMemories();
    } catch (e) {
      setError(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const deleteOne = async (id) => {
    const ok = window.confirm("Delete this memory?");
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/memory/${encodeURIComponent(id)}`);
      if (String(editId || "") === String(id || "")) cancelEdit();
      await fetchMemories();
    } catch (e) {
      setError(e?.message || "Failed to delete.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAll = async () => {
    const ok = window.confirm("Delete all memories? This cannot be undone.");
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      await api.delete("/memory");
      cancelEdit();
      await fetchMemories();
    } catch (e) {
      setError(e?.message || "Failed to delete.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (next) => {
    setSaving(true);
    setError("");
    try {
      const res = await api.patch("/memory/toggle", { enabled: Boolean(next) });
      setData((prev) => ({ ...(prev || {}), ...(res?.data || {}), enabled: Boolean(next) }));
    } catch (e) {
      setError(e?.message || "Failed to update.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="memory-backdrop" onClick={onClose}>
      <div className="memory-modal" onClick={(e) => e.stopPropagation()}>
        <div className="memory-header">
          <div className="memory-title-wrap">
            <h2 className="memory-title">Saved memories</h2>
            <div className="memory-subtitle">
              Core AI remembers useful info to personalize responses.
            </div>
          </div>
          <button className="memory-close" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="memory-body">
          <div className="memory-topbar">
            <div className="memory-search">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m21 21-4.3-4.3" />
                <circle cx="11" cy="11" r="7" />
              </svg>
              <input
                ref={queryRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories"
              />
            </div>

            <div className="memory-actions">
              <div className="memory-toggle-row" title="Enable/disable memory">
                <span className="memory-toggle-label">Memory</span>
                <Toggle checked={enabled} disabled={!available || saving} onChange={toggleEnabled} />
              </div>

              <IconButton
                title="Delete all"
                danger
                onClick={deleteAll}
                disabled={saving || items.length === 0}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
              </IconButton>
            </div>
          </div>

          <div className="memory-meta">
            <div className="memory-meta-left">
              {limit != null ? (
                <span>
                  Used: <strong>{formatMemoryCount(used)}</strong> / {formatMemoryCount(limit)}
                </span>
              ) : (
                <span>
                  Used: <strong>{formatMemoryCount(used)}</strong>
                </span>
              )}
              {!available && (
                <span className="memory-meta-warn">
                  Memory is not available on your plan.
                  {typeof onOpenPlan === "function" && (
                    <button type="button" className="memory-upgrade" onClick={onOpenPlan}>
                      Upgrade
                    </button>
                  )}
                </span>
              )}
            </div>
            {saving && <span className="memory-meta-right">Saving…</span>}
          </div>

          {error && <div className="memory-error">{error}</div>}

          <div className="memory-list">
            {loading ? (
              <div className="memory-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="memory-empty">No memories found.</div>
            ) : (
              filtered.map((m) => {
                const id = String(m?.id || "");
                const isEditing = editId && String(editId) === id;
                return (
                  <div key={id || `${m.content}`} className="memory-item">
                    <div className="memory-item-top">
                      <div className="memory-item-actions">
                        <IconButton title="Edit" onClick={() => beginEdit(m)} disabled={!available || saving}>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </IconButton>
                        <IconButton
                          title="Delete"
                          danger
                          onClick={() => deleteOne(id)}
                          disabled={saving}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </IconButton>
                      </div>
                    </div>

                    {!isEditing ? (
                      <div className="memory-content">{String(m?.content || "")}</div>
                    ) : (
                      <div className="memory-edit">
                        <textarea
                          ref={isEditing ? editTextareaRef : null}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                        />
                        <div className="memory-edit-row">
                          <div className="memory-edit-actions">
                            <button type="button" className="memory-btn" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </button>
                            <button type="button" className="memory-btn primary" onClick={saveEdit} disabled={saving}>
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
