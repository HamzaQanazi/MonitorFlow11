import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Organisation (admin, read-only) — GET /config/org.
//
// This page exists to make the TWO GATES visible, and it is deliberately not a
// "roles" screen. There is no boss/sub-boss ladder in this system (I2): there
// are exactly three account kinds, and authority comes from two orthogonal
// axes that this page shows side by side —
//
//   nesting (manager_id)  → Gate 2, WHO you can reach: self + everyone below.
//   capability chips      → Gate 1, WHAT you may do, granted by your level.
//
// They do not track each other: a field officer three levels down may hold
// view_all, and a root employee may hold almost nothing. Reading the tree as a
// seniority ranking is exactly the misreading this page should prevent, so the
// legend spells it out.
//
// Read-only by design: levels and reporting lines are set by the seed script or
// the Employees page, and there is no endpoint to reassign a manager.

interface OrgNode {
  id: number
  name: string
  managerId: number | null
  isActive: boolean
  departmentName: Loc | null
  levelName: Loc | null
  capabilities: string[]
}

// Flat wire → nested render. A node whose managerId isn't in the payload is
// treated as a root so nobody silently vanishes from the tree.
function childrenOf(all: OrgNode[], parentId: number | null) {
  const ids = new Set(all.map((n) => n.id))
  return all.filter((n) =>
    parentId === null ? n.managerId === null || !ids.has(n.managerId) : n.managerId === parentId,
  )
}

function Node({ node, all }: { node: OrgNode; all: OrgNode[] }) {
  const { t, L } = useI18n()
  const kids = childrenOf(all, node.id)
  return (
    <li className="org-node">
      <div className="org-card">
        <p className="org-name">
          {node.name}
          {!node.isActive && <span className="org-inactive"> · {t('org_inactive')}</span>}
        </p>
        <p className="org-meta">
          {node.levelName ? L(node.levelName) : t('org_no_level')}
          {node.departmentName && ` · ${L(node.departmentName)}`}
        </p>
        <p className="org-caps">
          {node.capabilities.length === 0 ? (
            <span className="org-cap is-none">{t('org_no_caps')}</span>
          ) : (
            node.capabilities.map((c) => (
              <span className="org-cap" key={c}>
                {c}
              </span>
            ))
          )}
        </p>
      </div>
      {kids.length > 0 && (
        <ul className="org-children">
          {kids.map((k) => (
            <Node key={k.id} node={k} all={all} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function OrgPage() {
  const { t } = useI18n()
  const [nodes, setNodes] = useState<OrgNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch<{ employees: OrgNode[] }>('/config/org')
    setNodes(res.employees)
    setError(null)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  const roots = nodes ? childrenOf(nodes, null) : []

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('org_title')}</h1>
        <p className="req-meta">{t('org_sub')}</p>
      </header>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('org_load_err')} {error}
          </p>
          <button
            type="button"
            className="req-retry"
            onClick={() => {
              setError(null)
              load().catch((err: Error) => setError(err.message))
            }}
          >
            {t('try_again')}
          </button>
        </div>
      ) : !nodes ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('org_loading')}</span>
          {Array.from({ length: 5 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <div className="req-empty">
          <h2>{t('org_none_h')}</h2>
          <p>{t('org_none_p')}</p>
        </div>
      ) : (
        <>
          <p className="org-legend">{t('org_legend')}</p>
          <ul className="org-tree">
            {roots.map((r) => (
              <Node key={r.id} node={r} all={nodes} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
