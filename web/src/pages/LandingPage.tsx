// Public marketing page, /welcome. NOT part of the console: no auth, no
// company data (mirrors LoginPage's constraint — brand.ts is build-time only
// pre-auth). Links out to /login; never linked from inside the console shell.
//
// Every product mockup on this page is a fictional "Meridian Facilities
// Group" persona — the same company shown in /screenshots/dashboard.jpg —
// so the hand-built diagrams below (workflow lifecycle, permissions,
// scheduling, audit log…) stay consistent with that one real screenshot
// instead of inventing a different demo company per section. Department/
// service names route through the i18n dict (I5 — they mirror real
// bilingual schema fields); fictional employee names/times/locations stay
// plain text, matching users.name's own non-localized shape in the schema.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Wordmark } from '../components/Wordmark'
import { NavIcon } from '../components/NavIcons'
import './LandingPage.css'

const MODULES = [
  { nameKey: 'nav_timeclock', descKey: 'landing_feat_timeclock_desc', icon: 'timeclock' },
  { nameKey: 'nav_schedule', descKey: 'landing_feat_schedule_desc', icon: 'schedule' },
  { nameKey: 'nav_checklists', descKey: 'landing_feat_checklists_desc', icon: 'checklists' },
  { nameKey: 'nav_knowledge_base', descKey: 'landing_feat_kb_desc', icon: 'knowledge_base' },
  { nameKey: 'nav_events', descKey: 'landing_feat_events_desc', icon: 'events' },
] as const

const STEPS = [
  { titleKey: 'landing_how_1_title', bodyKey: 'landing_how_1_body' },
  { titleKey: 'landing_how_2_title', bodyKey: 'landing_how_2_body' },
  { titleKey: 'landing_how_3_title', bodyKey: 'landing_how_3_body' },
] as const

const FLOW_STEPS = [
  'landing_flow_step_created',
  'landing_flow_step_assigned',
  'landing_flow_step_started',
  'landing_flow_step_submitted',
  'landing_flow_step_approval',
  'landing_flow_step_completed',
] as const

const ENGINE_BRANCHES = [
  'landing_engine2_branch_maintenance',
  'landing_engine2_branch_delivery',
  'landing_engine2_branch_inspection',
  'landing_engine2_branch_approval',
] as const

const ENGINE_CHIPS = [
  'landing_engine2_chip_forms',
  'landing_engine2_chip_statuses',
  'landing_engine2_chip_permissions',
  'landing_engine2_chip_transitions',
] as const

// Mirrors backend/src/lib/onboardingOptions.js's PLANS. Static here (not
// fetched) because this page is public/pre-auth — GET /onboarding/options
// requires a session, same reason brand.ts is build-time. Record-only: no
// prices, no billing (§13). Plans differ only by employeeCap — they never
// gate feature modules (re-scoped 2026-09-03, user-directed).
const PLANS = [
  { nameKey: 'landing_plan_starter', cap: 10 as number | null },
  { nameKey: 'landing_plan_growth', cap: 50 as number | null },
  { nameKey: 'landing_plan_enterprise', cap: null as number | null },
] as const

// Scroll-reveal: fade+slide a section in the first time it crosses into
// view, then stop watching it — one observer per section, no animation
// library. Children (list items, flow steps) stagger via CSS nth-child
// transition-delay rather than one observer each.
function Reveal({
  children,
  className = '',
  as: Tag = 'div',
  id,
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'footer'
  id?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag ref={ref} id={id} className={`reveal ${visible ? 'is-visible' : ''} ${className}`}>
      {children}
    </Tag>
  )
}

// A generic "app window" chrome — three traffic-light dots and an optional
// title bar — wrapping whichever mock interface a section needs. One shared
// frame keeps every product mockup on the page visually consistent instead
// of each section inventing its own container style.
function WindowChrome({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`mock-window ${className}`}>
      <div className="mock-window-bar">
        <span className="mock-window-dot" />
        <span className="mock-window-dot" />
        <span className="mock-window-dot" />
        {title && <span className="mock-window-title">{title}</span>}
      </div>
      <div className="mock-window-body">{children}</div>
    </div>
  )
}

// A phone bezel for the two Flutter apps. Pass `src` to show a real
// screenshot (captured from the actual Flutter web build, cropped to the
// bezel via object-fit) — falls back to hand-built schematic `children`
// only where no real capture exists for that screen.
function PhoneFrame({ children, label, src }: { children?: ReactNode; label: string; src?: string }) {
  return (
    <div className="mock-phone">
      <div className="mock-phone-notch" />
      <div className="mock-phone-screen">
        {src ? <img className="mock-phone-shot" src={src} alt="" /> : children}
      </div>
      <span className="mock-phone-label">{label}</span>
    </div>
  )
}

export default function LandingPage() {
  const { t, lang, setLang } = useI18n()
  const [activeStep, setActiveStep] = useState(0)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])

  // "Scrollytelling" nav: as the reader scrolls past each step in the left
  // column, the step nearest the viewport's vertical center is highlighted
  // and the sticky visual on the right reflects it (see landing-how-visual's
  // position: sticky in the CSS) — same pattern Attio/Linear use for their
  // product-tour sections.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const idx = stepRefs.current.indexOf(entry.target as HTMLLIElement)
          if (idx !== -1) setActiveStep(idx)
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    for (const el of stepRefs.current) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <main className="landing">
      <header className="landing-header">
        <Wordmark variant="login" />
        <div className="landing-header-actions">
          <button type="button" className="landing-lang" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {t('lang_toggle')}
          </button>
          <Link className="landing-signin" to="/login">
            {t('login_signin')}
          </Link>
        </div>
      </header>

      {/* ————— 1. Hero: headline, sub, two CTAs, dashboard-dominant visual ————— */}
      <section className="landing-hero">
        <p className="landing-eyebrow landing-hero-in">{t('landing_eyebrow')}</p>
        <h1 className="landing-hero-in landing-hero-in-1">{t('landing_hero_title')}</h1>
        <p className="landing-hero-sub landing-hero-in landing-hero-in-2">{t('landing_hero_sub')}</p>
        <div className="landing-hero-ctas landing-hero-in landing-hero-in-3">
          <Link className="landing-cta" to="/login">
            {t('landing_hero_cta')}
          </Link>
          <a className="landing-cta-secondary" href="#workflow">
            {t('landing_hero_cta_secondary')}
          </a>
        </div>
        <p className="landing-hero-note landing-hero-in landing-hero-in-3">{t('landing_hero_note')}</p>
      </section>

      <Reveal className="landing-hero-visual">
        {/* alt="" — decorative; the hero copy above already describes the product. */}
        <img className="landing-hero-shot" src="/screenshots/dashboard.jpg" alt="" />
        <div className="landing-hero-phone landing-hero-phone-a">
          <PhoneFrame label={t('landing_hero_mock_user_app')} src="/screenshots/mobile-user-home.jpg" />
        </div>
        <div className="landing-hero-phone landing-hero-phone-b">
          <PhoneFrame label={t('landing_hero_mock_employee_app')} src="/screenshots/mobile-employee-tasks.jpg" />
        </div>
      </Reveal>

      {/* ————— How it comes online (Owner provisioning + wizard) ————— */}
      <Reveal as="section" className="landing-section">
        <h2>{t('landing_how_title')}</h2>
        <div className="landing-how-grid">
          <ol className="landing-how-steps">
            {STEPS.map((step, i) => (
              <li
                key={step.titleKey}
                ref={(el) => {
                  stepRefs.current[i] = el
                }}
                className={`landing-how-step ${activeStep === i ? 'is-active' : ''}`}
              >
                <span className="landing-step-num">{i + 1}</span>
                <h3>{t(step.titleKey)}</h3>
                <p>{t(step.bodyKey)}</p>
              </li>
            ))}
          </ol>
          <div className="landing-how-visual">
            <div className="landing-shot-frame landing-shot-frame-sm">
              <img className="landing-shot-img" src="/screenshots/dashboard.jpg" alt="" />
            </div>
          </div>
        </div>
      </Reveal>

      {/* ————— 2. Operational workflow — show, don't tell the request lifecycle ————— */}
      <Reveal as="section" id="workflow" className="landing-band">
        <div className="landing-band-head">
          <p className="landing-eyebrow">{t('landing_flow_eyebrow')}</p>
          <h2 className="landing-h2">{t('landing_flow_title')}</h2>
          <p className="landing-band-sub">{t('landing_flow_sub')}</p>
        </div>
        <div className="flow-example">
          {t('landing_svc_generator')} · {t('landing_dept_facilities')} · Khaled Hamdan
        </div>
        <div className="flow-diagram">
          {FLOW_STEPS.map((key) => (
            <div key={key} className="flow-step">
              <span className="flow-dot" />
              <p>{t(key)}</p>
            </div>
          ))}
        </div>
        <figure className="flow-proof">
          <img className="flow-proof-img" src="/screenshots/request-detail.jpg" alt="" />
          <figcaption>{t('landing_flow_screenshot_caption')}</figcaption>
        </figure>
      </Reveal>

      {/* ————— 3. Dynamic workflow engine — the configuration differentiator (dark) ————— */}
      <Reveal as="section" className="landing-band landing-band-dark">
        <div className="landing-band-head">
          <p className="landing-eyebrow landing-eyebrow-dark">{t('landing_engine2_eyebrow')}</p>
          <h2 className="landing-h2 landing-h2-dark">{t('landing_engine2_title')}</h2>
          <p className="landing-band-sub landing-band-sub-dark">{t('landing_engine2_sub')}</p>
        </div>
        <div className="engine2-tree">
          <div className="engine2-root">{t('landing_engine2_root')}</div>
          <div className="engine2-trunk" />
          <div className="engine2-branches">
            {ENGINE_BRANCHES.map((key) => (
              <div key={key} className="engine2-branch">
                <div className="engine2-branch-card">{t(key)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="engine2-chips">
          {ENGINE_CHIPS.map((key) => (
            <span key={key} className="engine2-chip">
              {t(key)}
            </span>
          ))}
        </div>
        <p className="engine2-note">{t('landing_engine2_note')}</p>
      </Reveal>

      {/* ————— 4. Dynamic form engine — schema → form → record ————— */}
      <Reveal as="section" className="landing-band">
        <div className="landing-row">
          <div className="landing-row-text">
            <p className="landing-eyebrow">{t('landing_form_eyebrow')}</p>
            <h2 className="landing-h2">{t('landing_form_title')}</h2>
            <p className="landing-band-sub landing-band-sub-start">{t('landing_form_sub')}</p>
          </div>
          <div className="landing-row-visual">
            <div className="form-pipeline">
              <div className="form-pipeline-step">
                <WindowChrome title="schema.json" className="mock-window-sm">
                  <pre className="form-schema-code">{'{\n  "id": "issue",\n  "type": "multiline",\n  "required": true\n}'}</pre>
                </WindowChrome>
                <p className="form-pipeline-label">{t('landing_form_step_schema')}</p>
              </div>
              <span className="form-pipeline-arrow" aria-hidden="true">
                →
              </span>
              <div className="form-pipeline-step">
                <WindowChrome title={t('landing_svc_electrical')} className="mock-window-sm">
                  <div className="mock-form">
                    <span className="mock-form-label">{t('landing_form_field_issue')}</span>
                    <div className="mock-input mock-input-tall" />
                    <span className="mock-form-label">{t('landing_form_field_photo')}</span>
                    <div className="mock-input mock-photo" />
                    <span className="mock-form-label">{t('landing_form_field_parts')}</span>
                    <div className="mock-input" />
                  </div>
                </WindowChrome>
                <p className="form-pipeline-label">{t('landing_form_step_render')}</p>
              </div>
              <span className="form-pipeline-arrow" aria-hidden="true">
                →
              </span>
              <div className="form-pipeline-step">
                <WindowChrome title="#4821" className="mock-window-sm">
                  <div className="mock-record">
                    <div className="mock-record-row">
                      <span>{t('landing_form_field_issue')}</span>
                      <strong>Breaker tripping under load</strong>
                    </div>
                    <div className="mock-record-row">
                      <span>{t('landing_form_field_parts')}</span>
                      <strong>2× 20A breaker</strong>
                    </div>
                    <div className="mock-record-row">
                      <span>{t('landing_form_field_location')}</span>
                      <strong>Site 12 — North Yard</strong>
                    </div>
                  </div>
                </WindowChrome>
                <p className="form-pipeline-label">{t('landing_form_step_record')}</p>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ————— 5. Workforce modules — one large showcase, not five tiny cards ————— */}
      <Reveal as="section" className="landing-band landing-band-muted">
        <div className="landing-band-head">
          <h2 className="landing-h2">{t('landing_features_title')}</h2>
          <p className="landing-band-sub">{t('landing_features_sub')}</p>
        </div>
        <div className="modules-icons">
          {MODULES.map((m) => (
            <div key={m.nameKey} className="modules-icon">
              <NavIcon name={m.icon} />
              <span>{t(m.nameKey)}</span>
            </div>
          ))}
        </div>
        <figure className="modules-shot">
          <img className="modules-shot-img" src="/screenshots/schedule.jpg" alt="" />
          <figcaption>{t('landing_feat_schedule_desc')}</figcaption>
        </figure>
      </Reveal>

      {/* ————— 6. Permissions & department scope — Gate 1 + Gate 2 → allowed action ————— */}
      <Reveal as="section" className="landing-band">
        <div className="landing-row">
          <div className="landing-row-text">
            <p className="landing-eyebrow">{t('landing_perm_eyebrow')}</p>
            <h2 className="landing-h2">{t('landing_perm_title')}</h2>
            <p className="landing-band-sub landing-band-sub-start">{t('landing_perm_sub')}</p>
          </div>
          <div className="landing-row-visual">
            <div className="perm-diagram">
              <div className="perm-inputs">
                <div className="perm-chip">
                  <span className="perm-chip-label">{t('landing_perm_gate1_label')}</span>
                  <code className="perm-chip-value">assign · view_all</code>
                </div>
                <span className="perm-plus" aria-hidden="true">
                  +
                </span>
                <div className="perm-chip">
                  <span className="perm-chip-label">{t('landing_perm_gate2_label')}</span>
                  <strong>{t('landing_dept_facilities')}</strong>
                </div>
              </div>
              <span className="perm-arrow" aria-hidden="true">
                ↓
              </span>
              <div className="perm-result perm-result-allow">
                <span className="perm-result-dot" />
                <div>
                  <span className="perm-result-label">{t('landing_perm_result_label')}</span>
                  <p>{t('landing_perm_result_value')}</p>
                </div>
              </div>
              <div className="perm-result perm-result-deny">
                <span className="perm-result-dot" />
                <div>
                  <span className="perm-result-label">{t('landing_perm_denied_label')}</span>
                  <p>{t('landing_perm_denied_value')}</p>
                  <span className="perm-chip-value-sm">{t('landing_dept_warehouse')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ————— 7. Mobile field experience — the two Flutter apps, explained ————— */}
      <Reveal as="section" className="landing-band landing-band-muted">
        <div className="landing-band-head">
          <p className="landing-eyebrow">{t('landing_mobile_eyebrow')}</p>
          <h2 className="landing-h2">{t('landing_mobile_title')}</h2>
          <p className="landing-band-sub">{t('landing_mobile_sub')}</p>
        </div>
        <div className="mobile-showcase">
          <div className="mobile-showcase-item">
            <PhoneFrame label={t('landing_mobile_user_title')} src="/screenshots/mobile-user-home.jpg" />
            <ul className="mobile-points">
              <li>{t('landing_mobile_user_point1')}</li>
              <li>{t('landing_mobile_user_point2')}</li>
              <li>{t('landing_mobile_user_point3')}</li>
            </ul>
          </div>
          <div className="mobile-showcase-item">
            <PhoneFrame label={t('landing_mobile_emp_title')} src="/screenshots/mobile-employee-tasks.jpg" />
            <ul className="mobile-points">
              <li>{t('landing_mobile_emp_point1')}</li>
              <li>{t('landing_mobile_emp_point2')}</li>
              <li>{t('landing_mobile_emp_point3')}</li>
            </ul>
          </div>
        </div>
      </Reveal>

      {/* ————— 8. Scheduling & time clock ————— */}
      <Reveal as="section" className="landing-band">
        <div className="landing-row landing-row-reverse">
          <div className="landing-row-text">
            <p className="landing-eyebrow">{t('landing_sched_eyebrow')}</p>
            <h2 className="landing-h2">{t('landing_sched_title')}</h2>
            <p className="landing-band-sub landing-band-sub-start">{t('landing_sched_sub')}</p>
          </div>
          <div className="landing-row-visual">
            <img className="landing-row-shot" src="/screenshots/timeclock.jpg" alt="" />
          </div>
        </div>
      </Reveal>

      {/* ————— 9. AI-assisted features ————— */}
      <Reveal as="section" className="landing-band landing-band-muted">
        <div className="landing-band-head">
          <p className="landing-eyebrow">{t('landing_ai_eyebrow')}</p>
          <h2 className="landing-h2">{t('landing_ai_title')}</h2>
          <p className="landing-band-sub">{t('landing_ai_sub')}</p>
        </div>

        <div className="landing-row landing-row-tight">
          <div className="landing-row-text">
            <h3 className="landing-h3">{t('landing_ai_assign_title')}</h3>
            <p>{t('landing_ai_assign_body')}</p>
          </div>
          <div className="landing-row-visual">
            <div className="rank-list">
              {[
                { name: 'Omar Barghouti', score: 92 },
                { name: 'Khaled Hamdan', score: 78 },
                { name: 'Farah Nasser', score: 61 },
              ].map((c) => (
                <div className="rank-row" key={c.name}>
                  <span>{c.name}</span>
                  <div className="rank-bar">
                    <span style={{ width: `${c.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="landing-row landing-row-tight landing-row-reverse">
          <div className="landing-row-text">
            <h3 className="landing-h3">{t('landing_ai_translate_title')}</h3>
            <p>{t('landing_ai_translate_body')}</p>
          </div>
          <div className="landing-row-visual">
            <div className="translate-demo">
              <div className="mock-input mock-input-filled">Waste Pickup Request</div>
              <span className="translate-arrow" aria-hidden="true">
                ⇄
              </span>
              <div className="mock-input mock-input-filled mock-input-rtl" dir="rtl">
                طلب جمع النفايات
              </div>
            </div>
          </div>
        </div>

        <div className="landing-row landing-row-tight">
          <div className="landing-row-text">
            <h3 className="landing-h3">{t('landing_ai_schedule_title')}</h3>
            <p>{t('landing_ai_schedule_body')}</p>
          </div>
          <div className="landing-row-visual">
            <div className="suggest-strip">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                <span key={d} className={`suggest-cell ${i === 1 || i === 4 ? 'is-suggested' : ''}`}>
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      {/* ————— 10. Auditability & traceability ————— */}
      <Reveal as="section" className="landing-band">
        <div className="landing-band-head">
          <p className="landing-eyebrow">{t('landing_audit_eyebrow')}</p>
          <h2 className="landing-h2">{t('landing_audit_title')}</h2>
          <p className="landing-band-sub">{t('landing_audit_sub')}</p>
        </div>
        <img className="landing-shot-img audit-shot" src="/screenshots/audit-log.jpg" alt="" />
      </Reveal>

      {/* ————— 11. Bilingual / RTL — a real, mirrored comparison ————— */}
      <Reveal as="section" className="landing-bilingual">
        <p className="landing-eyebrow landing-eyebrow-dark">{t('landing_bilingual_eyebrow')}</p>
        <h2>{t('landing_bilingual_title')}</h2>
        <p>{t('landing_bilingual_body')}</p>
        <div className="bilingual-demo">
          <div className="bilingual-demo-card" dir="ltr">
            <div className="bilingual-demo-head">
              <span className="bilingual-demo-dot" />
              MonitorFlow
            </div>
            <div className="bilingual-demo-nav">
              <div className="bilingual-demo-item is-active">
                <NavIcon name="dashboard" />
                Dashboard
              </div>
              <div className="bilingual-demo-item">
                <NavIcon name="requests" />
                Requests
              </div>
              <div className="bilingual-demo-item">
                <NavIcon name="employees" />
                Employees
              </div>
            </div>
          </div>
          <div className="bilingual-demo-card" dir="rtl">
            <div className="bilingual-demo-head">
              <span className="bilingual-demo-dot" />
              مونيتر فلو
            </div>
            <div className="bilingual-demo-nav">
              <div className="bilingual-demo-item is-active">
                <NavIcon name="dashboard" />
                لوحة القيادة
              </div>
              <div className="bilingual-demo-item">
                <NavIcon name="requests" />
                الطلبات
              </div>
              <div className="bilingual-demo-item">
                <NavIcon name="employees" />
                الموظفون
              </div>
            </div>
          </div>
        </div>
        <p className="landing-bilingual-note">{t('landing_bilingual_note')}</p>
        <button type="button" className="landing-bilingual-toggle" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {t('landing_bilingual_toggle')}
        </button>
      </Reveal>

      {/* ————— Plans ————— */}
      <Reveal as="section" className="landing-section landing-section-muted">
        <h2>{t('landing_plans_title')}</h2>
        <p className="landing-section-sub">{t('landing_plans_sub')}</p>
        <ul className="landing-plans">
          {PLANS.map((p) => (
            <li key={p.nameKey} className="landing-plan">
              <h3>{t(p.nameKey)}</h3>
              <p className="landing-plan-cap">
                {p.cap === null ? t('ob_plan_unlimited') : `${t('ob_plan_up_to')} ${p.cap} ${t('ob_plan_employees')}`}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>

      {/* ————— 12. Final CTA ————— */}
      <Reveal as="footer" className="landing-footer">
        <div>
          <h2>{t('landing_footer_cta_title')}</h2>
          <p>{t('landing_footer_cta_body')}</p>
        </div>
        <Link className="landing-cta" to="/login">
          {t('login_signin')}
        </Link>
      </Reveal>
    </main>
  )
}
