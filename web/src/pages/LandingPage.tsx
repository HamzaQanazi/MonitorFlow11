// Public marketing page, /welcome. NOT part of the console: no auth, no
// company data (mirrors LoginPage's constraint — brand.ts is build-time only
// pre-auth). Links out to /login; never linked from inside the console shell.
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Wordmark } from '../components/Wordmark'
import './LandingPage.css'

const MODULES = [
  { nameKey: 'nav_timeclock', descKey: 'landing_feat_timeclock_desc' },
  { nameKey: 'nav_schedule', descKey: 'landing_feat_schedule_desc' },
  { nameKey: 'nav_checklists', descKey: 'landing_feat_checklists_desc' },
  { nameKey: 'nav_knowledge_base', descKey: 'landing_feat_kb_desc' },
  { nameKey: 'nav_events', descKey: 'landing_feat_events_desc' },
] as const

const ENGINE_POINTS = [
  { titleKey: 'landing_engine_1_title', bodyKey: 'landing_engine_1_body' },
  { titleKey: 'landing_engine_2_title', bodyKey: 'landing_engine_2_body' },
  { titleKey: 'landing_engine_3_title', bodyKey: 'landing_engine_3_body' },
] as const

const STEPS = [
  { titleKey: 'landing_how_1_title', bodyKey: 'landing_how_1_body' },
  { titleKey: 'landing_how_2_title', bodyKey: 'landing_how_2_body' },
  { titleKey: 'landing_how_3_title', bodyKey: 'landing_how_3_body' },
] as const

// Mirrors backend/src/lib/onboardingOptions.js's PLANS/FEATURE_GROUPS. Static
// here (not fetched) because this page is public/pre-auth — GET
// /onboarding/options requires a session, same reason brand.ts is build-time.
// Record-only: no prices, no billing (§13).
const PLANS = [
  { nameKey: 'landing_plan_starter', cap: 10 as number | null, groupKeys: ['nav_group_operations'] },
  { nameKey: 'landing_plan_growth', cap: 50 as number | null, groupKeys: ['nav_group_operations', 'nav_group_communication'] },
  { nameKey: 'landing_plan_enterprise', cap: null as number | null, groupKeys: ['nav_group_operations', 'nav_group_communication', 'landing_group_hr_skills'] },
] as const

export default function LandingPage() {
  const { t, lang, setLang } = useI18n()

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

      <section className="landing-hero">
        <p className="landing-eyebrow">{t('landing_eyebrow')}</p>
        <h1>{t('landing_hero_title')}</h1>
        <p className="landing-hero-sub">{t('landing_hero_sub')}</p>
        <Link className="landing-cta" to="/login">
          {t('landing_hero_cta')}
        </Link>
        <p className="landing-hero-note">{t('landing_hero_note')}</p>
      </section>

      <div className="landing-shot-frame">
        {/* alt="" — decorative; the hero copy above already describes the product. */}
        <img className="landing-shot-img" src="/screenshots/dashboard.jpg" alt="" />
      </div>

      <section className="landing-section">
        <h2>{t('landing_how_title')}</h2>
        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.titleKey} className="landing-step">
              <span className="landing-step-num">{i + 1}</span>
              <h3>{t(step.titleKey)}</h3>
              <p>{t(step.bodyKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-section-muted">
        <h2>{t('landing_features_title')}</h2>
        <p className="landing-section-sub">{t('landing_features_sub')}</p>
        <div className="landing-shot-frame landing-shot-frame-sm">
          <img className="landing-shot-img" src="/screenshots/dashboard.jpg" alt="" />
        </div>
        <ul className="landing-features">
          {MODULES.map((m) => (
            <li key={m.nameKey} className="landing-feature">
              <h3>{t(m.nameKey)}</h3>
              <p>{t(m.descKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section">
        <h2>{t('landing_engine_title')}</h2>
        <p className="landing-section-sub">{t('landing_engine_sub')}</p>
        <ul className="landing-engine">
          {ENGINE_POINTS.map((p) => (
            <li key={p.titleKey} className="landing-engine-point">
              <h3>{t(p.titleKey)}</h3>
              <p>{t(p.bodyKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-section-muted">
        <h2>{t('landing_plans_title')}</h2>
        <p className="landing-section-sub">{t('landing_plans_sub')}</p>
        <ul className="landing-plans">
          {PLANS.map((p) => (
            <li key={p.nameKey} className="landing-plan">
              <h3>{t(p.nameKey)}</h3>
              <p className="landing-plan-cap">
                {p.cap === null ? t('ob_plan_unlimited') : `${t('ob_plan_up_to')} ${p.cap} ${t('ob_plan_employees')}`}
              </p>
              <p className="landing-plan-includes">
                {t('ob_plan_includes')}: {p.groupKeys.map((k) => t(k)).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-bilingual">
        <h2>{t('landing_bilingual_title')}</h2>
        <p>{t('landing_bilingual_body')}</p>
        <button type="button" className="landing-bilingual-toggle" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {t('landing_bilingual_toggle')}
        </button>
      </section>

      <footer className="landing-footer">
        <div>
          <h2>{t('landing_footer_cta_title')}</h2>
          <p>{t('landing_footer_cta_body')}</p>
        </div>
        <Link className="landing-cta" to="/login">
          {t('login_signin')}
        </Link>
      </footer>
    </main>
  )
}
