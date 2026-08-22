import { useEffect, useMemo, useState } from 'react'
import { apiFetch, ApiError, getToken } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useI18n, type Loc } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import './RequestsPage.css'
import './EmployeesPage.css'
import './SettingsPage.css'

// Company settings — the post-onboarding editor for the same row the wizard
// writes. CLAUDE.md §15 listed "onboarding is one-shot with no in-app edit" as
// a limitation to state, not fix; re-scoped 2026-08-22 by explicit decision,
// because features, logo and branches were otherwise permanent and the
// documented workaround was a hand-edit of a live database.
//
// Deliberately not a re-run of the wizard: one page of grouped sections, one
// save, and onboarding_completed is never touched.

interface Options {
  employeeRanges: string[]
  industries: { key: string; label: Loc; subs: { key: string; label: Loc }[] }[]
  featureGroups: { key: string; label: Loc; features: { key: string; label: Loc }[] }[]
  plans: { key: string; name: Loc; employeeCap: number | null; featureGroups: string[] }[]
}
interface BranchRow {
  id: number | null
  en: string
  ar: string
  inUse: boolean
}
interface CompanyResponse {
  company: {
    name: Loc | null
    address: Loc | null
    ownerJobTitle: Loc | null
    employeeRange: string | null
    industry: string | null
    subIndustry: string | null
    plan: string | null
    emailDomain: string | null
    features: string[]
    logoFileId: string | null
    phone: string | null
    branches: { id: number; name: Loc; inUse: boolean }[]
  }
}

export default function SettingsPage() {
  const { t, L } = useI18n()
  const { user, markOnboarded } = useAuth()

  const [options, setOptions] = useState<Options | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmOff, setConfirmOff] = useState<string[] | null>(null)

  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [addressEn, setAddressEn] = useState('')
  const [addressAr, setAddressAr] = useState('')
  const [jobEn, setJobEn] = useState('')
  const [jobAr, setJobAr] = useState('')
  const [phone, setPhone] = useState('')
  const [employeeRange, setEmployeeRange] = useState('')
  const [industry, setIndustry] = useState('')
  const [subIndustry, setSubIndustry] = useState('')
  const [emailDomain, setEmailDomain] = useState('')
  const [plan, setPlan] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [originalFeatures, setOriginalFeatures] = useState<string[]>([])
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [hasLogo, setHasLogo] = useState(false)

  useEffect(() => {
    Promise.all([apiFetch<Options>('/onboarding/options'), apiFetch<CompanyResponse>('/company')])
      .then(([opts, { company: c }]) => {
        setOptions(opts)
        setNameEn(c.name?.en ?? '')
        setNameAr(c.name?.ar ?? '')
        setAddressEn(c.address?.en ?? '')
        setAddressAr(c.address?.ar ?? '')
        setJobEn(c.ownerJobTitle?.en ?? '')
        setJobAr(c.ownerJobTitle?.ar ?? '')
        setPhone(c.phone ?? '')
        setEmployeeRange(c.employeeRange ?? '')
        setIndustry(c.industry ?? '')
        setSubIndustry(c.subIndustry ?? '')
        setEmailDomain(c.emailDomain ?? '')
        setPlan(c.plan ?? '')
        // Keys for modules removed since onboarding (§13's Directory and
        // Training) are still stored but no longer in the catalogue — they
        // simply don't render, and the next save drops them.
        setFeatures(c.features)
        setOriginalFeatures(c.features)
        setHasLogo(!!c.logoFileId)
        setBranches(c.branches.map((b) => ({ id: b.id, en: b.name.en, ar: b.name.ar, inUse: b.inUse })))
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoaded(true))
  }, [])

  const subs = useMemo(
    () => options?.industries.find((i) => i.key === industry)?.subs ?? [],
    [options, industry],
  )

  function toggleFeature(key: string) {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]))
    setSaved(false)
  }

  async function uploadLogo(file: File): Promise<string> {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body,
    })
    if (!res.ok) throw new ApiError(res.status, 'logo upload failed', 'logo')
    const data = await res.json()
    return data.attachment.id
  }

  // Turning a module off hides it for everyone including the Owner, so it gets
  // the same confirmation any destructive action does (§11's UI rule).
  function submit() {
    const removed = originalFeatures.filter((f) => !features.includes(f))
    // Only warn about modules that still exist in the catalogue — a stored key
    // for a removed module isn't something the Owner is choosing to turn off.
    const known = new Set(options?.featureGroups.flatMap((g) => g.features.map((f) => f.key)) ?? [])
    const meaningful = removed.filter((f) => known.has(f))
    if (meaningful.length) {
      setConfirmOff(meaningful)
      return
    }
    void save()
  }

  async function save() {
    setConfirmOff(null)
    setBusy(true)
    setSaved(false)
    setSaveError('')
    setErrors({})
    try {
      const logoFileId = logoFile ? await uploadLogo(logoFile) : null
      const name = { en: nameEn, ar: nameAr }
      await apiFetch('/company', {
        method: 'PATCH',
        body: {
          name,
          address: { en: addressEn, ar: addressAr },
          ownerJobTitle: { en: jobEn, ar: jobAr },
          phone,
          employeeRange,
          industry,
          subIndustry,
          emailDomain,
          plan,
          features,
          logoFileId,
          branches: branches.map((b) => ({ id: b.id ?? undefined, en: b.en, ar: b.ar })),
        },
      })
      setSaved(true)
      setOriginalFeatures(features)
      if (logoFile) {
        setHasLogo(true)
        setLogoFile(null)
      }
      // Keep the shell wordmark and the nav's feature filter in step with what
      // was just saved, without forcing a re-login.
      markOnboarded(name, null, features)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { errors?: Record<string, string> } | undefined
        if (body?.errors) setErrors(body.errors)
      }
      setSaveError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="req-status">
        <p className="req-status-msg">{loadError}</p>
      </div>
    )
  }
  if (!loaded || !options) {
    return (
      <div className="req-skeleton" aria-busy="true">
        <span className="visually-hidden">{t('loading')}</span>
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skel-row" aria-hidden="true" key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('set_title')}</h1>
      </header>

      <div className="set-page">
        <section className="set-section">
          <header>
            <h2>{t('set_sec_company')}</h2>
          </header>
          <div className="set-pair">
            <SetField label={t('ob_company_name_en')} error={errors.name}>
              <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} aria-invalid={!!errors.name || undefined} />
            </SetField>
            <SetField label={t('ob_company_name_ar')}>
              <input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </SetField>
          </div>
          <div className="set-pair-action">
            <TranslateButton en={nameEn} ar={nameAr} setEn={setNameEn} setAr={setNameAr} />
          </div>

          <div className="set-pair">
            <SetField label={t('ob_company_address_en')} error={errors.address}>
              <input value={addressEn} onChange={(e) => setAddressEn(e.target.value)} aria-invalid={!!errors.address || undefined} />
            </SetField>
            <SetField label={t('ob_company_address_ar')}>
              <input dir="rtl" value={addressAr} onChange={(e) => setAddressAr(e.target.value)} />
            </SetField>
          </div>
          <div className="set-pair-action">
            <TranslateButton en={addressEn} ar={addressAr} setEn={setAddressEn} setAr={setAddressAr} />
          </div>

          <div className="set-pair">
            <SetField label={t('ob_job_title_en')} error={errors.ownerJobTitle}>
              <input value={jobEn} onChange={(e) => setJobEn(e.target.value)} aria-invalid={!!errors.ownerJobTitle || undefined} />
            </SetField>
            <SetField label={t('ob_job_title_ar')}>
              <input dir="rtl" value={jobAr} onChange={(e) => setJobAr(e.target.value)} />
            </SetField>
          </div>
          <div className="set-pair-action">
            <TranslateButton en={jobEn} ar={jobAr} setEn={setJobEn} setAr={setJobAr} />
          </div>

          <div className="set-pair">
            <SetField label={t('ob_phone')} error={errors.phone}>
              <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} aria-invalid={!!errors.phone || undefined} />
            </SetField>
          </div>
        </section>

        <section className="set-section">
          <header>
            <h2>{t('set_sec_profile')}</h2>
          </header>
          <div className="set-pair">
            <SetField label={t('ob_industry')} error={errors.industry}>
              <select
                value={industry}
                onChange={(e) => {
                  setIndustry(e.target.value)
                  setSubIndustry('')
                }}
              >
                <option value="">{t('ob_select')}</option>
                {options.industries.map((i) => (
                  <option key={i.key} value={i.key}>{L(i.label)}</option>
                ))}
              </select>
            </SetField>
            <SetField label={t('ob_sub_industry')} error={errors.subIndustry}>
              <select value={subIndustry} onChange={(e) => setSubIndustry(e.target.value)} disabled={!industry}>
                <option value="">{t('ob_select')}</option>
                {subs.map((sub) => (
                  <option key={sub.key} value={sub.key}>{L(sub.label)}</option>
                ))}
              </select>
            </SetField>
            <SetField label={t('ob_employee_count')} error={errors.employeeRange}>
              <select value={employeeRange} onChange={(e) => setEmployeeRange(e.target.value)}>
                <option value="">{t('ob_select')}</option>
                {options.employeeRanges.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </SetField>
          </div>
        </section>

        <section className="set-section">
          <header>
            <h2>{t('set_sec_branding')}</h2>
          </header>
          <div className="set-logo">
            {user?.companyLogo && !logoFile && (
              <img className="set-logo-preview" src={user.companyLogo} alt="" />
            )}
            <label className="set-file">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  setLogoFile(e.target.files?.[0] ?? null)
                  setSaved(false)
                }}
              />
              <span>{logoFile ? logoFile.name : hasLogo ? t('set_logo_replace') : t('ob_choose_file')}</span>
            </label>
            {errors.logoFileId && <span className="set-error">{errors.logoFileId}</span>}
          </div>
          <div className="set-pair">
            <SetField label={t('ob_email_domain')} error={errors.emailDomain} hint={t('ob_email_domain_hint')}>
              <input value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} aria-invalid={!!errors.emailDomain || undefined} />
            </SetField>
          </div>
        </section>

        <section className="set-section">
          <header>
            <h2>{t('set_branches_h')}</h2>
            <p>{branches.length}</p>
          </header>
          {errors.branches && <span className="set-error">{errors.branches}</span>}
          {branches.map((b, i) => (
            <div key={b.id ?? `new${i}`} className="set-branch">
              <SetField label={`${t('ob_branch_name_en')} ${i + 1}`}>
                <input
                  value={b.en}
                  onChange={(e) => setBranches((prev) => prev.map((r, j) => (j === i ? { ...r, en: e.target.value } : r)))}
                />
              </SetField>
              <SetField label={`${t('ob_branch_name_ar')} ${i + 1}`}>
                <input
                  dir="rtl"
                  value={b.ar}
                  onChange={(e) => setBranches((prev) => prev.map((r, j) => (j === i ? { ...r, ar: e.target.value } : r)))}
                />
              </SetField>
              <div className="set-branch-actions">
                <TranslateButton
                  en={b.en}
                  ar={b.ar}
                  setEn={(v) => setBranches((prev) => prev.map((r, j) => (j === i ? { ...r, en: v } : r)))}
                  setAr={(v) => setBranches((prev) => prev.map((r, j) => (j === i ? { ...r, ar: v } : r)))}
                />
                {branches.length > 1 && (
                  <button
                    type="button"
                    className="action-btn is-danger"
                    disabled={b.inUse}
                    title={b.inUse ? t('set_branch_in_use') : undefined}
                    onClick={() => setBranches((prev) => prev.filter((_, j) => j !== i))}
                  >
                    {t('svc_remove')}
                  </button>
                )}
              </div>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="action-btn"
              onClick={() => setBranches((prev) => [...prev, { id: null, en: '', ar: '', inUse: false }])}
            >
              {t('set_add_branch')}
            </button>
          </div>
        </section>

        <section className="set-section">
          <header>
            <h2>{t('set_features_h')}</h2>
            <p>{t('set_features_hint')}</p>
          </header>
          {errors.features && <span className="set-error">{errors.features}</span>}
          {options.featureGroups.map((g) => (
            <fieldset key={g.key} className="set-feature-group">
              <legend>{L(g.label)}</legend>
              <div className="set-feature-grid">
                {g.features.map((f) => (
                  <label key={f.key} className={features.includes(f.key) ? 'set-check is-on' : 'set-check'}>
                    <input type="checkbox" checked={features.includes(f.key)} onChange={() => toggleFeature(f.key)} />
                    <span>{L(f.label)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </section>

        <section className="set-section">
          <header>
            <h2>{t('set_plan_h')}</h2>
          </header>
          {errors.plan && <span className="set-error">{errors.plan}</span>}
          <div className="set-plans" role="radiogroup" aria-label={t('set_plan_h')}>
            {options.plans.map((p) => (
              <label key={p.key} className={p.key === plan ? 'set-plan is-on' : 'set-plan'}>
                <input type="radio" name="plan" checked={p.key === plan} onChange={() => setPlan(p.key)} />
                <span className="set-plan-name">{L(p.name)}</span>
                <span className="set-plan-cap">
                  {p.employeeCap == null
                    ? t('ob_plan_unlimited')
                    : `${t('ob_plan_up_to')} ${p.employeeCap} ${t('ob_plan_employees')}`}
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="set-bar">
          <button type="button" className="req-retry" onClick={submit} disabled={busy}>
            {busy ? t('ob_saving') : t('set_save')}
          </button>
          {saveError && (
            <span className="set-bar-status is-error" role="alert">
              {saveError}
            </span>
          )}
          {saved && !saveError && (
            <span className="set-bar-status" role="status">
              {t('set_saved')}
            </span>
          )}
        </div>
      </div>

      {confirmOff && (
        <div className="dialog-backdrop" onClick={() => setConfirmOff(null)}>
          <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h4>{t('set_confirm_features_h')}</h4>
            <ul>
              {confirmOff.map((key) => {
                const f = options.featureGroups.flatMap((g) => g.features).find((x) => x.key === key)
                return <li key={key}>{f ? L(f.label) : key}</li>
              })}
            </ul>
            <p className="req-status-msg">{t('set_features_hint')}</p>
            <div className="dialog-actions">
              <button type="button" className="detail-close-text" onClick={() => setConfirmOff(null)}>
                {t('cancel')}
              </button>
              <button type="button" className="req-retry is-danger" onClick={() => void save()}>
                {t('set_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SetField({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="set-field">
      <label>{label}</label>
      {children}
      {hint && <span className="set-hint">{hint}</span>}
      {error && <span className="set-error">{error}</span>}
    </div>
  )
}
