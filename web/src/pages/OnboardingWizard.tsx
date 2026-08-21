import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useI18n, type Loc } from '../i18n'
import { ApiError, apiFetch, getToken } from '../lib/api'
import { Wordmark } from '../components/Wordmark'
import { TranslateButton } from '../components/TranslateButton'
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

// The server keys its 422 errors by payload field; the wizard keys its inputs
// by step-local names (nameEn/nameAr for one `name`). Without this map a save
// rejection rendered nowhere at all and left the Owner on the last step under
// a generic "couldn't save" — the same problem AddServiceWizard's
// classifyErrors() solves. Each entry is [step index, the client field keys to
// light up].
const SERVER_FIELD_MAP: Record<string, [number, string[]]> = {
  name: [0, ['nameEn', 'nameAr']],
  address: [0, ['addressEn', 'addressAr']],
  ownerJobTitle: [0, ['ownerJobTitleEn', 'ownerJobTitleAr']],
  phone: [0, ['phone']],
  employeeRange: [1, ['employeeRange']],
  industry: [1, ['industry']],
  subIndustry: [1, ['subIndustry']],
  branches: [2, ['branches']],
  features: [3, ['features']],
  emailDomain: [4, ['emailDomain']],
  logoFileId: [4, ['logoFileId']],
  plan: [5, ['plan']],
}

function classifyServerErrors(serverErrors: Record<string, string>): { step: number; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  let step = STEP_COUNT - 1
  for (const [serverKey, message] of Object.entries(serverErrors)) {
    const entry = SERVER_FIELD_MAP[serverKey]
    if (!entry) continue
    const [stepIndex, clientKeys] = entry
    for (const k of clientKeys) errors[k] = message
    step = Math.min(step, stepIndex)
  }
  return { step, errors }
}
// Step 5's email-domain field — mirrors the backend's validation regex.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

// The lower bound of a step-2 employee-range string ("51-100" → 51, "500+" →
// 500) — used only to warn on the plan step (step 6) if a plan's cap looks too
// small for the declared size. Not a second cap; the plan's own employeeCap is
// the real one.
function employeeRangeFloor(range: string): number {
  return parseInt(range, 10) || 0
}

// Local preview of the picked logo file, so the shell wordmark can switch to
// it immediately on finish — the server's data-URI (auth.js) replaces this on
// the next login/restore, so this preview doesn't need to survive past that.
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function OnboardingWizard() {
  const { t, L } = useI18n()
  const { markOnboarded } = useAuth()

  const [options, setOptions] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Step 1 — name/address/job title are bilingual (I5): shown to every
  // console/mobile user via the wordmark regardless of their language, same
  // rationale as a system label.
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [addressEn, setAddressEn] = useState('')
  const [addressAr, setAddressAr] = useState('')
  const [ownerJobTitleEn, setOwnerJobTitleEn] = useState('')
  const [ownerJobTitleAr, setOwnerJobTitleAr] = useState('')
  const [phone, setPhone] = useState('')
  // Step 2
  const [employeeRange, setEmployeeRange] = useState('')
  const [industry, setIndustry] = useState('')
  const [subIndustry, setSubIndustry] = useState('')
  // Step 3 — bilingual, same rationale as the company name above.
  const [branchNames, setBranchNames] = useState<{ en: string; ar: string }[]>([{ en: '', ar: '' }])
  // Step 4
  const [features, setFeatures] = useState<string[]>([])
  // Step 5
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [uploadedLogoId, setUploadedLogoId] = useState<string | null>(null)
  const [emailDomain, setEmailDomain] = useState('')
  // Step 6
  const [plan, setPlan] = useState('')

  useEffect(() => {
    apiFetch<Options>('/onboarding/options')
      .then(setOptions)
      .catch(() => setLoadError(true))
  }, [])

  // Step-1 address helper: once the owner pauses typing a bare city name
  // (no comma yet) in the English address field, ask the backend to resolve
  // it and append ", Country". Guards against races: only applies if
  // `addressEn` hasn't changed since the lookup fired. English-only — the
  // backend's Nominatim proxy resolves Latin-script city/country names
  // (accept-language=en), so there's nothing sensible to auto-append to the
  // Arabic address field.
  useEffect(() => {
    const trimmed = addressEn.trim()
    if (addressEn.includes(',') || trimmed.length < 3) return
    const handle = setTimeout(() => {
      apiFetch<{ match: { city: string; country: string } | null }>(
        `/onboarding/geocode?q=${encodeURIComponent(trimmed)}`,
      )
        .then((res) => {
          if (!res.match) return
          setAddressEn((current) =>
            current.trim().toLowerCase() === trimmed.toLowerCase() && !current.includes(',')
              ? `${res.match!.city}, ${res.match!.country}`
              : current,
          )
        })
        .catch(() => {})
    }, 600)
    return () => clearTimeout(handle)
  }, [addressEn])

  const subs = useMemo(
    () => options?.industries.find((i) => i.key === industry)?.subs ?? [],
    [options, industry],
  )

  function setBranchCount(n: number) {
    const count = Math.max(1, Math.min(20, n || 1))
    setBranchNames((prev) => {
      const next = prev.slice(0, count)
      while (next.length < count) next.push({ en: '', ar: '' })
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
      req('nameEn', nameEn)
      req('nameAr', nameAr)
      req('addressEn', addressEn)
      req('addressAr', addressAr)
      req('ownerJobTitleEn', ownerJobTitleEn)
      req('ownerJobTitleAr', ownerJobTitleAr)
      req('phone', phone)
    } else if (s === 1) {
      if (!employeeRange) e.employeeRange = t('ob_err_required')
      if (!industry) e.industry = t('ob_err_required')
      if (!subIndustry) e.subIndustry = t('ob_err_required')
    } else if (s === 2) {
      branchNames.forEach((b, i) => {
        if (!b.en.trim()) e[`branch${i}en`] = t('ob_err_required')
        if (!b.ar.trim()) e[`branch${i}ar`] = t('ob_err_required')
      })
    } else if (s === 3) {
      if (!features.length) e.features = t('ob_err_pick_feature')
    } else if (s === 4) {
      if (!DOMAIN_RE.test(emailDomain.trim())) e.emailDomain = t('ob_err_domain')
      if (logoFile && !logoFile.type.startsWith('image/')) e.logoFileId = t('ob_err_logo_type')
    } else if (s === 5) {
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
      // Reuse the id from a previous attempt: the upload has to happen before
      // the save (the save needs its id), so a failed save used to leave a
      // parentless file behind and every retry added another one.
      let logoFileId = uploadedLogoId
      if (logoFile && !logoFileId) {
        logoFileId = await uploadLogo(logoFile)
        setUploadedLogoId(logoFileId)
      }
      const name = { en: nameEn, ar: nameAr }
      await apiFetch('/company/onboarding', {
        method: 'PATCH',
        body: {
          name,
          address: { en: addressEn, ar: addressAr },
          ownerJobTitle: { en: ownerJobTitleEn, ar: ownerJobTitleAr },
          employeeRange,
          industry,
          subIndustry,
          branches: branchNames,
          features,
          logoFileId,
          emailDomain,
          phone,
          plan,
        },
      })
      const logoPreview = logoFile ? await readAsDataUrl(logoFile).catch(() => null) : null
      markOnboarded(name, logoPreview, features)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'logo') {
        setSaveError(t('ob_err_logo'))
      } else if (err instanceof ApiError && err.status === 409) {
        // Another tab already finished this one-shot save.
        setSaveError(t('ob_err_already_done'))
      } else {
        if (err instanceof ApiError && err.status === 422) {
          const body = err.body as { errors?: Record<string, string> } | undefined
          if (body?.errors) {
            const { step: firstBadStep, errors: mapped } = classifyServerErrors(body.errors)
            setErrors(mapped)
            setStep(firstBadStep)
          }
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

  // 'ob_s6_title' (the old standalone Contact step) is gone — phone moved into
  // step 0 — so this list skips straight from s5 to s7 by position.
  const stepTitles = [
    'ob_s1_title',
    'ob_s2_title',
    'ob_s3_title',
    'ob_s4_title',
    'ob_s5_title',
    'ob_s7_title',
    'ob_review_title',
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
              <Field label={t('ob_company_name_en')} error={errors.nameEn}>
                <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} aria-invalid={!!errors.nameEn || undefined} />
              </Field>
              <Field label={t('ob_company_name_ar')} error={errors.nameAr}>
                <input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} aria-invalid={!!errors.nameAr || undefined} />
              </Field>
              <TranslateButton en={nameEn} ar={nameAr} setEn={setNameEn} setAr={setNameAr} />
              <Field label={t('ob_company_address_en')} error={errors.addressEn}>
                <input value={addressEn} onChange={(e) => setAddressEn(e.target.value)} aria-invalid={!!errors.addressEn || undefined} />
              </Field>
              <Field label={t('ob_company_address_ar')} error={errors.addressAr}>
                <input dir="rtl" value={addressAr} onChange={(e) => setAddressAr(e.target.value)} aria-invalid={!!errors.addressAr || undefined} />
              </Field>
              <Field label={t('ob_job_title_en')} error={errors.ownerJobTitleEn}>
                <input value={ownerJobTitleEn} onChange={(e) => setOwnerJobTitleEn(e.target.value)} aria-invalid={!!errors.ownerJobTitleEn || undefined} />
              </Field>
              <Field label={t('ob_job_title_ar')} error={errors.ownerJobTitleAr}>
                <input dir="rtl" value={ownerJobTitleAr} onChange={(e) => setOwnerJobTitleAr(e.target.value)} aria-invalid={!!errors.ownerJobTitleAr || undefined} />
              </Field>
              <TranslateButton en={ownerJobTitleEn} ar={ownerJobTitleAr} setEn={setOwnerJobTitleEn} setAr={setOwnerJobTitleAr} />
              <Field label={t('ob_phone')} error={errors.phone}>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" aria-invalid={!!errors.phone || undefined} />
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
              {errors.branches && <span className="ob-field-error">{errors.branches}</span>}
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
                <div key={i} className="ob-branch-pair">
                  <Field label={`${t('ob_branch_name_en')} ${i + 1}`} error={errors[`branch${i}en`]}>
                    <input
                      value={b.en}
                      onChange={(e) => {
                        const next = [...branchNames]
                        next[i] = { ...next[i], en: e.target.value }
                        setBranchNames(next)
                      }}
                      aria-invalid={!!errors[`branch${i}en`] || undefined}
                    />
                  </Field>
                  <Field label={`${t('ob_branch_name_ar')} ${i + 1}`} error={errors[`branch${i}ar`]}>
                    <input
                      dir="rtl"
                      value={b.ar}
                      onChange={(e) => {
                        const next = [...branchNames]
                        next[i] = { ...next[i], ar: e.target.value }
                        setBranchNames(next)
                      }}
                      aria-invalid={!!errors[`branch${i}ar`] || undefined}
                    />
                  </Field>
                  <TranslateButton
                    en={b.en}
                    ar={b.ar}
                    setEn={(v) => {
                      const next = [...branchNames]
                      next[i] = { ...next[i], en: v }
                      setBranchNames(next)
                    }}
                    setAr={(v) => {
                      const next = [...branchNames]
                      next[i] = { ...next[i], ar: v }
                      setBranchNames(next)
                    }}
                  />
                </div>
              ))}
            </>
          )}

          {step === 3 && (
            <>
              <p className="ob-hint">{t('ob_features_hint')}</p>
              {errors.features && <span className="ob-field-error">{errors.features}</span>}
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
              <Field label={t('ob_logo')} error={errors.logoFileId}>
                <label className="ob-file">
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      setLogoFile(e.target.files?.[0] ?? null)
                      setUploadedLogoId(null)
                    }}
                  />
                  <span>{logoFile ? logoFile.name : t('ob_choose_file')}</span>
                </label>
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
                    {/* Step 2's employee range is a size hint, not a second cap —
                        the plan's own employeeCap (enforced server-side when
                        adding employees) is the only real limit. */}
                    {p.employeeCap != null && p.employeeCap < employeeRangeFloor(employeeRange) && (
                      <span className="ob-plan-warning">{t('ob_plan_size_warning')}</span>
                    )}
                  </label>
                ))}
              </div>
              {errors.plan && <span className="ob-field-error">{errors.plan}</span>}
            </>
          )}

          {step === 6 && (
            <>
              <p className="ob-hint">{t('ob_review_hint')}</p>
              <dl className="ob-review">
                <dt>{t('ob_company_name_en')}</dt>
                <dd>{nameEn} / {nameAr}</dd>
                <dt>{t('ob_company_address_en')}</dt>
                <dd>{addressEn} / {addressAr}</dd>
                <dt>{t('ob_job_title_en')}</dt>
                <dd>{ownerJobTitleEn} / {ownerJobTitleAr}</dd>
                <dt>{t('ob_phone')}</dt>
                <dd>{phone}</dd>
                <dt>{t('ob_industry')}</dt>
                <dd>
                  {L(options.industries.find((i) => i.key === industry)?.label ?? { en: industry, ar: industry })}
                  {' · '}
                  {L(subs.find((sub) => sub.key === subIndustry)?.label ?? { en: subIndustry, ar: subIndustry })}
                </dd>
                <dt>{t('ob_employee_count')}</dt>
                <dd>{employeeRange}</dd>
                <dt>{t('ob_s3_title')}</dt>
                <dd>{branchNames.map((b) => b.en).join(', ')}</dd>
                <dt>{t('ob_s4_title')}</dt>
                <dd>
                  {options.featureGroups
                    .flatMap((g) => g.features)
                    .filter((f) => features.includes(f.key))
                    .map((f) => L(f.label))
                    .join(', ')}
                </dd>
                <dt>{t('ob_email_domain')}</dt>
                <dd>{emailDomain}</dd>
                <dt>{t('ob_logo')}</dt>
                <dd>{logoFile ? logoFile.name : '—'}</dd>
                <dt>{t('ob_s7_title')}</dt>
                <dd>{L(options.plans.find((p) => p.key === plan)?.name ?? { en: plan, ar: plan })}</dd>
              </dl>
              <p className="ob-hint">{t('ob_review_editable')}</p>
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
