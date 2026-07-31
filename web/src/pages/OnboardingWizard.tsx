import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useI18n, type Loc } from '../i18n'
import { ApiError, apiFetch, getToken } from '../lib/api'
import { Wordmark } from '../components/Wordmark'
import './OnboardingWizard.css'

// The first-login "Customize your app in 1 minute" wizard. Six steps, one save
// at the end (PATCH /company/onboarding); the server re-validates every pick.
// Thin client (I4): ranges/industries/features come from GET /onboarding/options
// as { en, ar } labels, rendered through L() so the wizard flips with the
// console language and RTL.

type Options = {
  employeeRanges: string[]
  industries: { key: string; label: Loc; subs: { key: string; label: Loc }[] }[]
  featureGroups: { key: string; label: Loc; features: { key: string; label: Loc }[] }[]
  plans: { key: string; name: Loc; employeeCap: number | null; featureGroups: string[] }[]
}

const STEP_COUNT = 7
// Step 5's email-domain field — mirrors the backend's validation regex.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

export default function OnboardingWizard() {
  const { t, L } = useI18n()
  const { markOnboarded } = useAuth()

  const [options, setOptions] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Step 1
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [ownerJobTitle, setOwnerJobTitle] = useState('')
  // Step 2
  const [employeeRange, setEmployeeRange] = useState('')
  const [industry, setIndustry] = useState('')
  const [subIndustry, setSubIndustry] = useState('')
  // Step 3
  const [branchNames, setBranchNames] = useState<string[]>([''])
  // Step 4
  const [features, setFeatures] = useState<string[]>([])
  // Step 5
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [website, setWebsite] = useState('')
  const [emailDomain, setEmailDomain] = useState('')
  // Step 6
  const [phone, setPhone] = useState('')
  // Step 7
  const [plan, setPlan] = useState('')

  useEffect(() => {
    apiFetch<Options>('/onboarding/options')
      .then(setOptions)
      .catch(() => setLoadError(true))
  }, [])

  // Step-1 address helper: once the owner pauses typing a bare city name
  // (no comma yet), ask the backend to resolve it and append ", Country".
  // Guards against races: only applies if `address` hasn't changed since the
  // lookup fired.
  useEffect(() => {
    const trimmed = address.trim()
    if (address.includes(',') || trimmed.length < 3) return
    const handle = setTimeout(() => {
      apiFetch<{ match: { city: string; country: string } | null }>(
        `/onboarding/geocode?q=${encodeURIComponent(trimmed)}`,
      )
        .then((res) => {
          if (!res.match) return
          setAddress((current) =>
            current.trim().toLowerCase() === trimmed.toLowerCase() && !current.includes(',')
              ? `${res.match!.city}, ${res.match!.country}`
              : current,
          )
        })
        .catch(() => {})
    }, 600)
    return () => clearTimeout(handle)
  }, [address])

  const subs = useMemo(
    () => options?.industries.find((i) => i.key === industry)?.subs ?? [],
    [options, industry],
  )

  function setBranchCount(n: number) {
    const count = Math.max(1, Math.min(20, n || 1))
    setBranchNames((prev) => {
      const next = prev.slice(0, count)
      while (next.length < count) next.push('')
      return next
    })
  }

  function toggleFeature(key: string) {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]))
  }

  // Client validation is UX only — the server re-checks everything (I8).
  function validateStep(s: number): Record<string, string> {
    const e: Record<string, string> = {}
    const req = (k: string, v: string) => {
      if (!v.trim()) e[k] = t('ob_err_required')
    }
    if (s === 0) {
      req('name', name)
      req('address', address)
      req('ownerJobTitle', ownerJobTitle)
    } else if (s === 1) {
      if (!employeeRange) e.employeeRange = t('ob_err_required')
      if (!industry) e.industry = t('ob_err_required')
      if (!subIndustry) e.subIndustry = t('ob_err_required')
    } else if (s === 2) {
      branchNames.forEach((b, i) => {
        if (!b.trim()) e[`branch${i}`] = t('ob_err_required')
      })
    } else if (s === 4) {
      if (!DOMAIN_RE.test(emailDomain.trim())) e.emailDomain = t('ob_err_domain')
    } else if (s === 5) {
      req('phone', phone)
    } else if (s === 6) {
      if (!plan) e.plan = t('ob_err_required')
    }
    return e
  }

  function next() {
    const e = validateStep(step)
    setErrors(e)
    if (Object.keys(e).length) return
    if (step < STEP_COUNT - 1) setStep(step + 1)
    else void finish()
  }

  function back() {
    setSaveError('')
    setErrors({})
    if (step > 0) setStep(step - 1)
  }

  // Two-step logo: POST the file, then send its id in the save. multipart, so a
  // raw fetch rather than apiFetch (which is JSON-only).
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

  async function finish() {
    setBusy(true)
    setSaveError('')
    try {
      const logoFileId = logoFile ? await uploadLogo(logoFile) : null
      await apiFetch('/company/onboarding', {
        method: 'PATCH',
        body: {
          name,
          address,
          ownerJobTitle,
          employeeRange,
          industry,
          subIndustry,
          branches: branchNames,
          features,
          logoFileId,
          website,
          emailDomain,
          phone,
          plan,
        },
      })
      markOnboarded()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'logo') {
        setSaveError(t('ob_err_logo'))
      } else {
        if (err instanceof ApiError && err.status === 422) {
          const body = err.body as { errors?: Record<string, string> } | undefined
          if (body?.errors) setErrors(body.errors)
        }
        setSaveError(t('ob_err_save'))
      }
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="ob-overlay">
        <div className="ob-card ob-card-msg" role="alert">
          <p>{t('ob_err_save')}</p>
          <button className="ob-btn ob-btn-primary" type="button" onClick={() => location.reload()}>
            {t('try_again')}
          </button>
        </div>
      </div>
    )
  }

  if (!options) {
    return (
      <div className="ob-overlay">
        <div className="ob-card ob-card-msg" role="status" aria-label={t('loading')}>
          <span className="spinner" />
        </div>
      </div>
    )
  }

  const stepTitles = [
    'ob_s1_title',
    'ob_s2_title',
    'ob_s3_title',
    'ob_s4_title',
    'ob_s5_title',
    'ob_s6_title',
    'ob_s7_title',
  ]

  return (
    <div className="ob-overlay">
      <div className="ob-card" role="dialog" aria-modal="true" aria-label={t('ob_title')}>
        <header className="ob-head">
          <Wordmark variant="shell" />
          <h1>{t('ob_title')}</h1>
          <p className="ob-progress-label">
            {t('ob_step_of')} {step + 1} {t('of')} {STEP_COUNT}
          </p>
          <div className="ob-progress" role="presentation">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} className={i <= step ? 'ob-seg ob-seg-on' : 'ob-seg'} />
            ))}
          </div>
        </header>

        <div className="ob-body">
          <h2>{t(stepTitles[step])}</h2>

          {step === 0 && (
            <>
              <Field label={t('ob_company_name')} error={errors.name}>
                <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name || undefined} />
              </Field>
              <Field label={t('ob_company_address')} error={errors.address}>
                <input value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={!!errors.address || undefined} />
              </Field>
              <Field label={t('ob_job_title')} error={errors.ownerJobTitle}>
                <input value={ownerJobTitle} onChange={(e) => setOwnerJobTitle(e.target.value)} aria-invalid={!!errors.ownerJobTitle || undefined} />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <Field label={t('ob_employee_count')} error={errors.employeeRange}>
                <select value={employeeRange} onChange={(e) => setEmployeeRange(e.target.value)} aria-invalid={!!errors.employeeRange || undefined}>
                  <option value="">{t('ob_select')}</option>
                  {options.employeeRanges.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('ob_industry')} error={errors.industry}>
                <select
                  value={industry}
                  onChange={(e) => {
                    setIndustry(e.target.value)
                    setSubIndustry('')
                  }}
                  aria-invalid={!!errors.industry || undefined}
                >
                  <option value="">{t('ob_select')}</option>
                  {options.industries.map((i) => (
                    <option key={i.key} value={i.key}>{L(i.label)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('ob_sub_industry')} error={errors.subIndustry}>
                <select value={subIndustry} onChange={(e) => setSubIndustry(e.target.value)} disabled={!industry} aria-invalid={!!errors.subIndustry || undefined}>
                  <option value="">{t('ob_select')}</option>
                  {subs.map((s) => (
                    <option key={s.key} value={s.key}>{L(s.label)}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label={t('ob_branch_count')}>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={branchNames.length}
                  onChange={(e) => setBranchCount(Number(e.target.value))}
                />
              </Field>
              {branchNames.map((b, i) => (
                <Field key={i} label={`${t('ob_branch_name')} ${i + 1}`} error={errors[`branch${i}`]}>
                  <input
                    value={b}
                    onChange={(e) => {
                      const next = [...branchNames]
                      next[i] = e.target.value
                      setBranchNames(next)
                    }}
                    aria-invalid={!!errors[`branch${i}`] || undefined}
                  />
                </Field>
              ))}
            </>
          )}

          {step === 3 && (
            <>
              <p className="ob-hint">{t('ob_features_hint')}</p>
              {options.featureGroups.map((g) => (
                <fieldset key={g.key} className="ob-feature-group">
                  <legend>{L(g.label)}</legend>
                  {g.features.map((f) => (
                    <label key={f.key} className="ob-check">
                      <input type="checkbox" checked={features.includes(f.key)} onChange={() => toggleFeature(f.key)} />
                      <span>{L(f.label)}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </>
          )}

          {step === 4 && (
            <>
              <Field label={t('ob_logo')}>
                <label className="ob-file">
                  <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
                  <span>{logoFile ? logoFile.name : t('ob_choose_file')}</span>
                </label>
              </Field>
              <Field label={t('ob_website')}>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
              </Field>
              <Field label={t('ob_email_domain')} error={errors.emailDomain}>
                <input
                  value={emailDomain}
                  onChange={(e) => setEmailDomain(e.target.value)}
                  placeholder="company.org"
                  aria-invalid={!!errors.emailDomain || undefined}
                />
                <span className="ob-hint">{t('ob_email_domain_hint')}</span>
              </Field>
            </>
          )}

          {step === 5 && (
            <Field label={t('ob_phone')} error={errors.phone}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" aria-invalid={!!errors.phone || undefined} />
            </Field>
          )}

          {step === 6 && (
            <>
              <p className="ob-hint">{t('ob_plan_hint')}</p>
              <div className="ob-plan-list" role="radiogroup" aria-label={t('ob_s7_title')}>
                {options.plans.map((p) => (
                  <label key={p.key} className={p.key === plan ? 'ob-plan-card ob-plan-card-on' : 'ob-plan-card'}>
                    <input type="radio" name="plan" checked={p.key === plan} onChange={() => setPlan(p.key)} />
                    <span className="ob-plan-name">{L(p.name)}</span>
                    <span className="ob-plan-cap">
                      {p.employeeCap == null
                        ? t('ob_plan_unlimited')
                        : `${t('ob_plan_up_to')} ${p.employeeCap} ${t('ob_plan_employees')}`}
                    </span>
                    <span className="ob-plan-includes">
                      {t('ob_plan_includes')}:{' '}
                      {p.featureGroups
                        .map((gKey) => L(options.featureGroups.find((g) => g.key === gKey)?.label ?? { en: gKey, ar: gKey }))
                        .join(', ')}
                    </span>
                  </label>
                ))}
              </div>
              {errors.plan && <span className="ob-field-error">{errors.plan}</span>}
            </>
          )}

          {saveError && <p className="ob-error" role="alert">{saveError}</p>}
        </div>

        <footer className="ob-foot">
          <button className="ob-btn" type="button" onClick={back} disabled={step === 0 || busy}>
            {t('previous')}
          </button>
          <button className="ob-btn ob-btn-primary" type="button" onClick={next} disabled={busy}>
            {busy ? t('ob_saving') : step === STEP_COUNT - 1 ? t('ob_finish') : t('next')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="ob-field">
      <label>{label}</label>
      {children}
      {error && <span className="ob-field-error">{error}</span>}
    </div>
  )
}
