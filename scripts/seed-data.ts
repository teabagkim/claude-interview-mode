// seed-data.ts — Interview Mode MCP Data Seeder
// Generates 300 simulated interview sessions (3 rounds × 100 personas)
// and sends them to the Edge Function to train the Bayesian evolution system.

// ─── Types ───

interface CheckpointDef {
  name: string;
  decisionProb: number;
}

interface CategoryDef {
  checkpoints: CheckpointDef[];
  discoverable: { name: string; decisionProb: number; round: 2 | 3 }[];
}

interface CoverageEvent {
  checkpoint_name: string;
  led_to_decision: boolean;
}

interface RecordPayload {
  category: string;
  covered_checkpoints: string[];
  checkpoints_total: number;
  total_qas: number;
  total_decisions: number;
  duration_seconds: number;
  coverage_order: CoverageEvent[];
  decision_topics: string[];
  known_checkpoint_names: string[];
}

interface Persona {
  id: string;
  category: string;
  experience: "beginner" | "intermediate" | "expert";
  thoroughness: number;
  decisiveness: number;
  round: 1 | 2 | 3;
}

// ─── Constants ───

const EDGE_FUNCTION_URL =
  "https://wxbwktkgmdqzrpljmmvj.supabase.co/functions/v1/super-api";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4YndrdGtnbWRxenJwbGptbXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNTg0MDksImV4cCI6MjA4NTkzNDQwOX0.ZNYcZG85TyoZIxWMAW-r321V7rEG6FjZZaZ4q0ujZG8";

const REQUEST_DELAY_MS = 200;

// ─── Seeded PRNG (mulberry32) ───

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng: () => number;

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return rng() * (max - min) + min;
}

function gaussianNoise(mean: number, stddev: number): number {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedSample<T>(items: T[], weights: number[], count: number): T[] {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const selected: T[] = [];
  const used = new Set<number>();

  while (selected.length < count && selected.length < items.length) {
    let r = rng() * totalWeight;
    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      r -= weights[i];
      if (r <= 0) {
        selected.push(items[i]);
        used.add(i);
        break;
      }
    }
    // Fallback: pick first unused
    if (selected.length < used.size) {
      for (let i = 0; i < items.length; i++) {
        if (!used.has(i)) {
          selected.push(items[i]);
          used.add(i);
          break;
        }
      }
    }
  }
  return selected;
}

// ─── 22 Categories ───

const CATEGORIES: Record<string, CategoryDef> = {
  "saas-pricing": {
    checkpoints: [
      { name: "pricing-model", decisionProb: 0.85 },
      { name: "target-customer", decisionProb: 0.70 },
      { name: "competitor-pricing", decisionProb: 0.25 },
      { name: "free-tier-limits", decisionProb: 0.80 },
      { name: "billing-cycle", decisionProb: 0.75 },
      { name: "price-anchoring", decisionProb: 0.30 },
      { name: "usage-metrics", decisionProb: 0.65 },
      { name: "enterprise-plan", decisionProb: 0.55 },
      { name: "discount-strategy", decisionProb: 0.40 },
      { name: "localized-pricing", decisionProb: 0.20 },
      { name: "payment-providers", decisionProb: 0.60 },
      { name: "revenue-projections", decisionProb: 0.15 },
    ],
    discoverable: [
      { name: "annual-discount-size", decisionProb: 0.65, round: 2 },
      { name: "usage-overage-pricing", decisionProb: 0.55, round: 2 },
      { name: "startup-program", decisionProb: 0.40, round: 3 },
    ],
  },
  "api-design": {
    checkpoints: [
      { name: "rest-vs-graphql", decisionProb: 0.90 },
      { name: "authentication-method", decisionProb: 0.85 },
      { name: "rate-limiting", decisionProb: 0.70 },
      { name: "versioning-strategy", decisionProb: 0.75 },
      { name: "error-format", decisionProb: 0.60 },
      { name: "pagination-style", decisionProb: 0.65 },
      { name: "webhook-support", decisionProb: 0.50 },
      { name: "documentation-tool", decisionProb: 0.55 },
      { name: "sdk-generation", decisionProb: 0.35 },
      { name: "caching-strategy", decisionProb: 0.45 },
      { name: "idempotency", decisionProb: 0.30 },
      { name: "cors-policy", decisionProb: 0.40 },
      { name: "api-gateway", decisionProb: 0.50 },
    ],
    discoverable: [
      { name: "grpc-support", decisionProb: 0.50, round: 2 },
      { name: "api-key-rotation", decisionProb: 0.60, round: 2 },
      { name: "openapi-spec-version", decisionProb: 0.45, round: 3 },
    ],
  },
  "mvp-scope": {
    checkpoints: [
      { name: "core-problem", decisionProb: 0.80 },
      { name: "target-user", decisionProb: 0.75 },
      { name: "must-have-features", decisionProb: 0.90 },
      { name: "nice-to-have-features", decisionProb: 0.45 },
      { name: "launch-timeline", decisionProb: 0.70 },
      { name: "tech-stack", decisionProb: 0.85 },
      { name: "success-metrics", decisionProb: 0.35 },
      { name: "feedback-mechanism", decisionProb: 0.40 },
      { name: "deployment-platform", decisionProb: 0.65 },
      { name: "data-model", decisionProb: 0.60 },
      { name: "third-party-integrations", decisionProb: 0.50 },
    ],
    discoverable: [
      { name: "analytics-mvp", decisionProb: 0.50, round: 2 },
      { name: "admin-panel-scope", decisionProb: 0.55, round: 2 },
      { name: "beta-access-strategy", decisionProb: 0.45, round: 3 },
    ],
  },
  "startup-validation": {
    checkpoints: [
      { name: "problem-hypothesis", decisionProb: 0.75 },
      { name: "customer-segments", decisionProb: 0.70 },
      { name: "validation-method", decisionProb: 0.80 },
      { name: "competitive-landscape", decisionProb: 0.25 },
      { name: "unique-value-prop", decisionProb: 0.65 },
      { name: "revenue-model", decisionProb: 0.60 },
      { name: "market-size", decisionProb: 0.20 },
      { name: "first-customers", decisionProb: 0.55 },
      { name: "pivot-criteria", decisionProb: 0.40 },
      { name: "go-to-market", decisionProb: 0.50 },
    ],
    discoverable: [
      { name: "landing-page-test", decisionProb: 0.60, round: 2 },
      { name: "pre-sale-strategy", decisionProb: 0.55, round: 2 },
      { name: "advisor-network", decisionProb: 0.35, round: 3 },
    ],
  },
  "database-design": {
    checkpoints: [
      { name: "sql-vs-nosql", decisionProb: 0.90 },
      { name: "primary-database", decisionProb: 0.85 },
      { name: "schema-design", decisionProb: 0.70 },
      { name: "indexing-strategy", decisionProb: 0.40 },
      { name: "migration-tool", decisionProb: 0.65 },
      { name: "backup-strategy", decisionProb: 0.35 },
      { name: "read-write-patterns", decisionProb: 0.30 },
      { name: "caching-layer", decisionProb: 0.55 },
      { name: "multi-tenancy", decisionProb: 0.60 },
      { name: "data-retention", decisionProb: 0.25 },
      { name: "search-engine", decisionProb: 0.50 },
      { name: "replication", decisionProb: 0.20 },
    ],
    discoverable: [
      { name: "connection-pooling", decisionProb: 0.55, round: 2 },
      { name: "read-replica-strategy", decisionProb: 0.50, round: 2 },
      { name: "time-series-handling", decisionProb: 0.40, round: 3 },
    ],
  },
  "user-onboarding": {
    checkpoints: [
      { name: "signup-flow", decisionProb: 0.80 },
      { name: "social-login", decisionProb: 0.75 },
      { name: "onboarding-steps", decisionProb: 0.65 },
      { name: "email-verification", decisionProb: 0.60 },
      { name: "welcome-email", decisionProb: 0.50 },
      { name: "tutorial-style", decisionProb: 0.55 },
      { name: "progress-indicator", decisionProb: 0.30 },
      { name: "personalization", decisionProb: 0.40 },
      { name: "activation-metric", decisionProb: 0.35 },
      { name: "empty-states", decisionProb: 0.45 },
    ],
    discoverable: [
      { name: "checklist-gamification", decisionProb: 0.50, round: 2 },
      { name: "invite-flow", decisionProb: 0.55, round: 2 },
      { name: "contextual-tooltips", decisionProb: 0.40, round: 3 },
    ],
  },
  "landing-page": {
    checkpoints: [
      { name: "hero-messaging", decisionProb: 0.75 },
      { name: "call-to-action", decisionProb: 0.80 },
      { name: "social-proof", decisionProb: 0.45 },
      { name: "feature-showcase", decisionProb: 0.55 },
      { name: "pricing-section", decisionProb: 0.70 },
      { name: "faq-section", decisionProb: 0.30 },
      { name: "seo-strategy", decisionProb: 0.40 },
      { name: "analytics-setup", decisionProb: 0.50 },
      { name: "a-b-testing", decisionProb: 0.25 },
      { name: "mobile-responsive", decisionProb: 0.60 },
      { name: "page-speed", decisionProb: 0.20 },
    ],
    discoverable: [
      { name: "exit-intent-popup", decisionProb: 0.45, round: 2 },
      { name: "video-demo", decisionProb: 0.55, round: 2 },
      { name: "chatbot-integration", decisionProb: 0.40, round: 3 },
    ],
  },
  "auth-system": {
    checkpoints: [
      { name: "auth-provider", decisionProb: 0.90 },
      { name: "session-management", decisionProb: 0.65 },
      { name: "password-policy", decisionProb: 0.50 },
      { name: "mfa-support", decisionProb: 0.55 },
      { name: "oauth-providers", decisionProb: 0.75 },
      { name: "role-based-access", decisionProb: 0.70 },
      { name: "token-strategy", decisionProb: 0.60 },
      { name: "account-recovery", decisionProb: 0.40 },
      { name: "audit-logging", decisionProb: 0.25 },
      { name: "security-headers", decisionProb: 0.30 },
    ],
    discoverable: [
      { name: "passkey-support", decisionProb: 0.60, round: 2 },
      { name: "device-fingerprinting", decisionProb: 0.45, round: 2 },
      { name: "session-revocation", decisionProb: 0.50, round: 3 },
    ],
  },
  "deployment-strategy": {
    checkpoints: [
      { name: "hosting-platform", decisionProb: 0.90 },
      { name: "ci-cd-pipeline", decisionProb: 0.75 },
      { name: "environment-setup", decisionProb: 0.65 },
      { name: "monitoring-tool", decisionProb: 0.60 },
      { name: "logging-strategy", decisionProb: 0.40 },
      { name: "rollback-plan", decisionProb: 0.35 },
      { name: "domain-setup", decisionProb: 0.70 },
      { name: "ssl-certificate", decisionProb: 0.30 },
      { name: "container-orchestration", decisionProb: 0.45 },
    ],
    discoverable: [
      { name: "blue-green-deployment", decisionProb: 0.50, round: 2 },
      { name: "cdn-configuration", decisionProb: 0.55, round: 2 },
      { name: "auto-scaling-rules", decisionProb: 0.45, round: 3 },
    ],
  },
  "content-strategy": {
    checkpoints: [
      { name: "content-types", decisionProb: 0.70 },
      { name: "publishing-cadence", decisionProb: 0.60 },
      { name: "seo-keywords", decisionProb: 0.50 },
      { name: "content-distribution", decisionProb: 0.45 },
      { name: "editorial-calendar", decisionProb: 0.35 },
      { name: "content-management", decisionProb: 0.55 },
      { name: "guest-posting", decisionProb: 0.25 },
      { name: "video-content", decisionProb: 0.40 },
      { name: "newsletter-strategy", decisionProb: 0.65 },
      { name: "content-repurposing", decisionProb: 0.30 },
    ],
    discoverable: [
      { name: "ai-content-workflow", decisionProb: 0.55, round: 2 },
      { name: "content-localization", decisionProb: 0.45, round: 2 },
      { name: "podcast-strategy", decisionProb: 0.40, round: 3 },
    ],
  },
  "mobile-app": {
    checkpoints: [
      { name: "native-vs-cross-platform", decisionProb: 0.90 },
      { name: "framework-choice", decisionProb: 0.85 },
      { name: "offline-support", decisionProb: 0.50 },
      { name: "push-notifications", decisionProb: 0.60 },
      { name: "app-store-strategy", decisionProb: 0.55 },
      { name: "deep-linking", decisionProb: 0.35 },
      { name: "performance-budget", decisionProb: 0.25 },
      { name: "device-compatibility", decisionProb: 0.40 },
      { name: "state-management", decisionProb: 0.65 },
      { name: "testing-strategy", decisionProb: 0.45 },
      { name: "release-process", decisionProb: 0.55 },
    ],
    discoverable: [
      { name: "app-size-optimization", decisionProb: 0.45, round: 2 },
      { name: "crash-reporting", decisionProb: 0.50, round: 2 },
      { name: "in-app-purchase", decisionProb: 0.60, round: 3 },
    ],
  },
  "team-hiring": {
    checkpoints: [
      { name: "first-hire-role", decisionProb: 0.80 },
      { name: "hiring-timeline", decisionProb: 0.65 },
      { name: "compensation-model", decisionProb: 0.70 },
      { name: "remote-vs-office", decisionProb: 0.75 },
      { name: "interview-process", decisionProb: 0.45 },
      { name: "equity-allocation", decisionProb: 0.55 },
      { name: "contractor-vs-fulltime", decisionProb: 0.60 },
      { name: "culture-values", decisionProb: 0.30 },
      { name: "hiring-channels", decisionProb: 0.40 },
    ],
    discoverable: [
      { name: "trial-project", decisionProb: 0.55, round: 2 },
      { name: "referral-bonus", decisionProb: 0.45, round: 2 },
      { name: "async-interview", decisionProb: 0.40, round: 3 },
    ],
  },
  "email-system": {
    checkpoints: [
      { name: "email-provider", decisionProb: 0.85 },
      { name: "transactional-emails", decisionProb: 0.70 },
      { name: "marketing-emails", decisionProb: 0.55 },
      { name: "template-design", decisionProb: 0.45 },
      { name: "deliverability", decisionProb: 0.30 },
      { name: "unsubscribe-flow", decisionProb: 0.40 },
      { name: "email-automation", decisionProb: 0.60 },
      { name: "analytics-tracking", decisionProb: 0.35 },
      { name: "spam-compliance", decisionProb: 0.25 },
      { name: "email-personalization", decisionProb: 0.40 },
    ],
    discoverable: [
      { name: "drip-campaign-design", decisionProb: 0.55, round: 2 },
      { name: "email-a-b-testing", decisionProb: 0.45, round: 2 },
      { name: "transactional-sms-fallback", decisionProb: 0.35, round: 3 },
    ],
  },
  "analytics-setup": {
    checkpoints: [
      { name: "analytics-tool", decisionProb: 0.85 },
      { name: "key-metrics", decisionProb: 0.70 },
      { name: "event-tracking", decisionProb: 0.60 },
      { name: "dashboard-design", decisionProb: 0.45 },
      { name: "funnel-analysis", decisionProb: 0.50 },
      { name: "cohort-analysis", decisionProb: 0.30 },
      { name: "data-privacy", decisionProb: 0.40 },
      { name: "reporting-cadence", decisionProb: 0.35 },
    ],
    discoverable: [
      { name: "custom-event-taxonomy", decisionProb: 0.50, round: 2 },
      { name: "attribution-model", decisionProb: 0.55, round: 2 },
      { name: "real-time-dashboard", decisionProb: 0.45, round: 3 },
    ],
  },
  "notification-system": {
    checkpoints: [
      { name: "notification-channels", decisionProb: 0.80 },
      { name: "notification-preferences", decisionProb: 0.60 },
      { name: "real-time-delivery", decisionProb: 0.55 },
      { name: "notification-grouping", decisionProb: 0.35 },
      { name: "quiet-hours", decisionProb: 0.25 },
      { name: "notification-templates", decisionProb: 0.45 },
      { name: "in-app-notifications", decisionProb: 0.70 },
      { name: "push-provider", decisionProb: 0.65 },
      { name: "notification-history", decisionProb: 0.30 },
    ],
    discoverable: [
      { name: "digest-notifications", decisionProb: 0.50, round: 2 },
      { name: "smart-delivery-timing", decisionProb: 0.45, round: 2 },
      { name: "notification-a-b-testing", decisionProb: 0.35, round: 3 },
    ],
  },
  "payment-integration": {
    checkpoints: [
      { name: "payment-processor", decisionProb: 0.90 },
      { name: "subscription-management", decisionProb: 0.80 },
      { name: "invoice-generation", decisionProb: 0.55 },
      { name: "refund-policy", decisionProb: 0.60 },
      { name: "tax-handling", decisionProb: 0.45 },
      { name: "multi-currency", decisionProb: 0.40 },
      { name: "payment-security", decisionProb: 0.35 },
      { name: "checkout-ux", decisionProb: 0.65 },
      { name: "failed-payment-recovery", decisionProb: 0.50 },
      { name: "revenue-recognition", decisionProb: 0.20 },
    ],
    discoverable: [
      { name: "payment-method-priority", decisionProb: 0.55, round: 2 },
      { name: "grace-period-handling", decisionProb: 0.50, round: 2 },
      { name: "crypto-payment-support", decisionProb: 0.30, round: 3 },
    ],
  },
  "search-feature": {
    checkpoints: [
      { name: "search-engine-choice", decisionProb: 0.85 },
      { name: "search-indexing", decisionProb: 0.60 },
      { name: "autocomplete", decisionProb: 0.55 },
      { name: "faceted-search", decisionProb: 0.50 },
      { name: "relevance-tuning", decisionProb: 0.30 },
      { name: "search-analytics", decisionProb: 0.25 },
      { name: "typo-tolerance", decisionProb: 0.35 },
      { name: "search-filters", decisionProb: 0.65 },
      { name: "search-ux", decisionProb: 0.45 },
    ],
    discoverable: [
      { name: "vector-search", decisionProb: 0.55, round: 2 },
      { name: "search-personalization", decisionProb: 0.45, round: 2 },
      { name: "federated-search", decisionProb: 0.40, round: 3 },
    ],
  },
  "testing-strategy": {
    checkpoints: [
      { name: "testing-framework", decisionProb: 0.85 },
      { name: "unit-test-coverage", decisionProb: 0.50 },
      { name: "integration-tests", decisionProb: 0.60 },
      { name: "e2e-testing", decisionProb: 0.65 },
      { name: "test-data-management", decisionProb: 0.35 },
      { name: "ci-test-pipeline", decisionProb: 0.55 },
      { name: "performance-testing", decisionProb: 0.30 },
      { name: "snapshot-testing", decisionProb: 0.25 },
      { name: "mocking-strategy", decisionProb: 0.40 },
      { name: "test-environment", decisionProb: 0.45 },
    ],
    discoverable: [
      { name: "visual-regression-testing", decisionProb: 0.50, round: 2 },
      { name: "contract-testing", decisionProb: 0.45, round: 2 },
      { name: "chaos-engineering", decisionProb: 0.30, round: 3 },
    ],
  },
  "internationalization": {
    checkpoints: [
      { name: "i18n-framework", decisionProb: 0.85 },
      { name: "target-languages", decisionProb: 0.80 },
      { name: "translation-workflow", decisionProb: 0.55 },
      { name: "rtl-support", decisionProb: 0.35 },
      { name: "date-number-formatting", decisionProb: 0.45 },
      { name: "content-localization", decisionProb: 0.50 },
      { name: "language-detection", decisionProb: 0.40 },
      { name: "translation-management", decisionProb: 0.60 },
      { name: "locale-routing", decisionProb: 0.50 },
    ],
    discoverable: [
      { name: "machine-translation-pipeline", decisionProb: 0.50, round: 2 },
      { name: "pluralization-rules", decisionProb: 0.40, round: 2 },
      { name: "cultural-adaptation", decisionProb: 0.35, round: 3 },
    ],
  },
  "security-audit": {
    checkpoints: [
      { name: "vulnerability-scanning", decisionProb: 0.65 },
      { name: "dependency-audit", decisionProb: 0.55 },
      { name: "input-validation", decisionProb: 0.50 },
      { name: "data-encryption", decisionProb: 0.60 },
      { name: "access-control-review", decisionProb: 0.45 },
      { name: "security-headers-review", decisionProb: 0.40 },
      { name: "penetration-testing", decisionProb: 0.35 },
      { name: "incident-response", decisionProb: 0.30 },
      { name: "compliance-requirements", decisionProb: 0.50 },
      { name: "secrets-management", decisionProb: 0.70 },
    ],
    discoverable: [
      { name: "bug-bounty-program", decisionProb: 0.40, round: 2 },
      { name: "zero-trust-architecture", decisionProb: 0.45, round: 2 },
      { name: "supply-chain-security", decisionProb: 0.35, round: 3 },
    ],
  },
  "feature-flags": {
    checkpoints: [
      { name: "flag-management-tool", decisionProb: 0.85 },
      { name: "rollout-strategy", decisionProb: 0.70 },
      { name: "targeting-rules", decisionProb: 0.50 },
      { name: "flag-lifecycle", decisionProb: 0.35 },
      { name: "a-b-testing-integration", decisionProb: 0.45 },
      { name: "flag-naming-convention", decisionProb: 0.30 },
      { name: "emergency-kill-switch", decisionProb: 0.55 },
      { name: "flag-analytics", decisionProb: 0.40 },
    ],
    discoverable: [
      { name: "progressive-rollout", decisionProb: 0.55, round: 2 },
      { name: "flag-dependency-graph", decisionProb: 0.40, round: 2 },
      { name: "feature-entitlements", decisionProb: 0.45, round: 3 },
    ],
  },
  "data-pipeline": {
    checkpoints: [
      { name: "etl-tool", decisionProb: 0.85 },
      { name: "data-sources", decisionProb: 0.75 },
      { name: "transformation-logic", decisionProb: 0.55 },
      { name: "scheduling", decisionProb: 0.60 },
      { name: "error-handling", decisionProb: 0.45 },
      { name: "data-quality-checks", decisionProb: 0.40 },
      { name: "storage-format", decisionProb: 0.65 },
      { name: "real-time-vs-batch", decisionProb: 0.80 },
      { name: "data-catalog", decisionProb: 0.30 },
      { name: "monitoring-alerts", decisionProb: 0.35 },
    ],
    discoverable: [
      { name: "schema-evolution", decisionProb: 0.50, round: 2 },
      { name: "data-lineage-tracking", decisionProb: 0.45, round: 2 },
      { name: "cost-optimization", decisionProb: 0.40, round: 3 },
    ],
  },
};

// ─── Persona Generation ───

function generatePersonas(round: 1 | 2 | 3, count: number): Persona[] {
  const categoryNames = Object.keys(CATEGORIES);
  const personas: Persona[] = [];

  // Distribute personas across categories as evenly as possible
  const perCategory = Math.floor(count / categoryNames.length);
  const remainder = count % categoryNames.length;
  const distribution: string[] = [];

  for (let i = 0; i < categoryNames.length; i++) {
    const extra = i < remainder ? 1 : 0;
    for (let j = 0; j < perCategory + extra; j++) {
      distribution.push(categoryNames[i]);
    }
  }

  // Shuffle to randomize order
  const shuffled = shuffle(distribution);

  for (let i = 0; i < shuffled.length; i++) {
    const roll = rng();
    let experience: "beginner" | "intermediate" | "expert";
    if (roll < 0.30) experience = "beginner";
    else if (roll < 0.75) experience = "intermediate";
    else experience = "expert";

    let thoroughness: number;
    let decisiveness: number;
    switch (experience) {
      case "beginner":
        thoroughness = randFloat(0.40, 0.60);
        decisiveness = randFloat(0.60, 0.90);
        break;
      case "intermediate":
        thoroughness = randFloat(0.50, 0.75);
        decisiveness = randFloat(0.80, 1.10);
        break;
      case "expert":
        thoroughness = randFloat(0.65, 0.90);
        decisiveness = randFloat(1.00, 1.40);
        break;
    }

    personas.push({
      id: `r${round}-p${String(i + 1).padStart(3, "0")}`,
      category: shuffled[i],
      experience,
      thoroughness,
      decisiveness,
      round,
    });
  }

  return personas;
}

// ─── Session Generation ───

function generateSession(persona: Persona): RecordPayload {
  const catDef = CATEGORIES[persona.category];
  let availableCheckpoints = [...catDef.checkpoints];

  // In rounds 2-3, include previously discovered checkpoints
  if (persona.round >= 2) {
    const round2Discovered = catDef.discoverable.filter((d) => d.round === 2);
    availableCheckpoints.push(
      ...round2Discovered.map((d) => ({ name: d.name, decisionProb: d.decisionProb }))
    );
  }
  if (persona.round >= 3) {
    const round3Discovered = catDef.discoverable.filter((d) => d.round === 3);
    availableCheckpoints.push(
      ...round3Discovered.map((d) => ({ name: d.name, decisionProb: d.decisionProb }))
    );
  }

  const totalAvailable = availableCheckpoints.length;

  // Determine coverage count
  const numCovered = Math.max(
    2,
    Math.min(
      totalAvailable,
      Math.round(totalAvailable * persona.thoroughness)
    )
  );

  // Weighted selection: higher decision prob → more likely to be covered
  const weights = availableCheckpoints.map((cp) => 0.3 + 0.7 * cp.decisionProb);
  const coveredCps = weightedSample(availableCheckpoints, weights, numCovered);

  // Order: high-decision checkpoints tend to come first
  const noiseScale = persona.round === 3 ? 0.15 : 0.25;
  const ordered = coveredCps
    .map((cp) => ({
      ...cp,
      sortKey: (1 - cp.decisionProb) + gaussianNoise(0, noiseScale),
    }))
    .sort((a, b) => a.sortKey - b.sortKey);

  // Determine led_to_decision for each
  const coverageOrder: CoverageEvent[] = ordered.map((cp) => ({
    checkpoint_name: cp.name,
    led_to_decision: rng() < Math.min(0.95, cp.decisionProb * persona.decisiveness),
  }));

  const totalDecisions = coverageOrder.filter((e) => e.led_to_decision).length;
  const coveredNames = coverageOrder.map((e) => e.checkpoint_name);

  // Decision topics: checkpoints that led to decisions
  const decisionTopics = coverageOrder
    .filter((e) => e.led_to_decision)
    .map((e) => e.checkpoint_name);

  // In rounds 2-3, chance to discover new checkpoint via decision topic
  const discoveryChance = persona.round === 2 ? 0.15 : persona.round === 3 ? 0.10 : 0;
  const newDiscoveries: string[] = [];

  if (rng() < discoveryChance) {
    const roundDiscoverable = catDef.discoverable.filter(
      (d) => d.round === persona.round
    );
    if (roundDiscoverable.length > 0) {
      const disc = roundDiscoverable[randInt(0, roundDiscoverable.length - 1)];
      // Only discover if not already in available checkpoints
      if (!availableCheckpoints.some((cp) => cp.name === disc.name)) {
        newDiscoveries.push(disc.name);
        decisionTopics.push(disc.name);
      }
    }
  }

  // Known checkpoint names: all base checkpoints for this category
  const knownNames = catDef.checkpoints.map((cp) => cp.name);
  // Plus discovered ones from previous rounds
  if (persona.round >= 2) {
    knownNames.push(
      ...catDef.discoverable
        .filter((d) => d.round < persona.round)
        .map((d) => d.name)
    );
  }

  // Calculate QAs and duration
  let minQas: number, maxQas: number;
  let minDur: number, maxDur: number;

  switch (persona.experience) {
    case "beginner":
      minQas = 5; maxQas = 12;
      minDur = 300; maxDur = 900;
      break;
    case "intermediate":
      minQas = 8; maxQas = 18;
      minDur = 600; maxDur = 1800;
      break;
    case "expert":
      minQas = 12; maxQas = 25;
      minDur = 1200; maxDur = 3600;
      break;
  }

  const totalQas = Math.max(numCovered, randInt(minQas, maxQas));
  const durationSeconds = randInt(minDur, maxDur);

  // Ensure decisions don't exceed constraints
  const actualDecisions = Math.max(
    totalDecisions > 0 ? totalDecisions : (decisionTopics.length > 0 ? decisionTopics.length : 1),
    1
  );

  return {
    category: persona.category,
    covered_checkpoints: coveredNames,
    checkpoints_total: totalAvailable,
    total_qas: totalQas,
    total_decisions: actualDecisions,
    duration_seconds: durationSeconds,
    coverage_order: coverageOrder,
    decision_topics: decisionTopics,
    known_checkpoint_names: knownNames,
  };
}

// ─── Validation (mirrors Edge Function spam checks) ───

function validatePayload(payload: RecordPayload): string | null {
  if (payload.total_qas === 0 && payload.total_decisions === 0) {
    return "Empty interview";
  }
  if (payload.duration_seconds < 10 && payload.total_qas > 0) {
    return "Session too short";
  }
  if (payload.total_decisions > 0 && payload.duration_seconds > 0) {
    const dpm = (payload.total_decisions / payload.duration_seconds) * 60;
    if (dpm > 30) return `Implausible decision rate: ${dpm.toFixed(1)}/min`;
  }
  if (
    payload.covered_checkpoints.length >
    payload.checkpoints_total + payload.total_decisions
  ) {
    return "Covered exceeds available";
  }
  if (payload.category.length < 1 || payload.category.length > 200) {
    return "Invalid category length";
  }
  if (payload.covered_checkpoints.length > 100) return "Too many covered checkpoints";
  if (payload.coverage_order.length > 100) return "Too many coverage events";
  if (payload.decision_topics.length > 100) return "Too many decision topics";
  if (payload.known_checkpoint_names.length > 500) return "Too many known checkpoints";
  return null;
}

// ─── HTTP Sender ───

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPayload(
  payload: RecordPayload,
  maxRetries: number = 3
): Promise<{ ok: boolean; status: number; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok || res.status === 207) {
        return { ok: true, status: res.status };
      }

      if (res.status === 422) {
        const body = await res.text();
        return { ok: false, status: 422, error: body };
      }

      // Server error → retry
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }

      const body = await res.text();
      return { ok: false, status: res.status, error: body };
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, status: 0, error: String(err) };
    }
  }
  return { ok: false, status: 0, error: "Max retries exhausted" };
}

// ─── Main ───

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const seedArg = args.find((a) => a.startsWith("--seed="));
  const roundArg = args.find((a) => a.startsWith("--round="));
  const seed = seedArg ? parseInt(seedArg.split("=")[1], 10) : 42;
  const onlyRound = roundArg ? parseInt(roundArg.split("=")[1], 10) as 1 | 2 | 3 : null;

  rng = mulberry32(seed);

  const categoryNames = Object.keys(CATEGORIES);
  const totalBaseCheckpoints = categoryNames.reduce(
    (sum, name) => sum + CATEGORIES[name].checkpoints.length,
    0
  );
  const totalDiscoverable = categoryNames.reduce(
    (sum, name) => sum + CATEGORIES[name].discoverable.length,
    0
  );

  console.log("=== Interview Mode Data Seeder ===");
  console.log(`Seed: ${seed}`);
  console.log(`Categories: ${categoryNames.length}`);
  console.log(`Checkpoints: ${totalBaseCheckpoints} base + ${totalDiscoverable} discoverable`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  if (onlyRound) console.log(`Only Round: ${onlyRound}`);
  console.log("");

  const rounds: (1 | 2 | 3)[] = onlyRound ? [onlyRound] : [1, 2, 3];
  let grandTotal = 0;
  let grandSuccess = 0;
  let grandRejected = 0;
  let grandFailed = 0;

  for (const round of rounds) {
    console.log(`--- Round ${round} (${round === 1 ? "Foundation" : round === 2 ? "Deepening" : "Maturation"}) ---`);

    const personas = generatePersonas(round, 100);
    let success = 0;
    let rejected = 0;
    let failed = 0;
    let totalDecisions = 0;
    let totalCoverage = 0;
    const categoryHits: Record<string, number> = {};

    for (let i = 0; i < personas.length; i++) {
      const persona = personas[i];
      const payload = generateSession(persona);

      // Pre-flight validation
      const validationErr = validatePayload(payload);
      if (validationErr) {
        console.log(
          `[${i + 1}/100] ${persona.category.padEnd(22)} | SKIP: ${validationErr}`
        );
        rejected++;
        continue;
      }

      totalDecisions += payload.total_decisions;
      totalCoverage += payload.covered_checkpoints.length / payload.checkpoints_total;
      categoryHits[persona.category] = (categoryHits[persona.category] || 0) + 1;

      if (dryRun) {
        console.log(
          `[${i + 1}/100] ${persona.category.padEnd(22)} | ` +
            `QAs:${String(payload.total_qas).padStart(2)} ` +
            `Dec:${String(payload.total_decisions).padStart(2)} ` +
            `Cov:${String(payload.covered_checkpoints.length).padStart(2)}/${String(payload.checkpoints_total).padStart(2)} ` +
            `Dur:${String(payload.duration_seconds).padStart(4)}s ` +
            `| DRY OK`
        );
        success++;
      } else {
        const result = await sendPayload(payload);
        if (result.ok) {
          console.log(
            `[${i + 1}/100] ${persona.category.padEnd(22)} | ` +
              `QAs:${String(payload.total_qas).padStart(2)} ` +
              `Dec:${String(payload.total_decisions).padStart(2)} ` +
              `Cov:${String(payload.covered_checkpoints.length).padStart(2)}/${String(payload.checkpoints_total).padStart(2)} ` +
              `Dur:${String(payload.duration_seconds).padStart(4)}s ` +
              `| OK (${result.status})`
          );
          success++;
        } else if (result.status === 422) {
          console.log(
            `[${i + 1}/100] ${persona.category.padEnd(22)} | REJECTED: ${result.error}`
          );
          rejected++;
        } else {
          console.log(
            `[${i + 1}/100] ${persona.category.padEnd(22)} | FAILED (${result.status}): ${result.error}`
          );
          failed++;
        }
        await sleep(REQUEST_DELAY_MS);
      }
    }

    const avgCoverage = personas.length > 0 ? ((totalCoverage / (success + rejected)) * 100).toFixed(1) : "0";

    console.log("");
    console.log(`Round ${round} Summary:`);
    console.log(`  Sent: ${success + rejected + failed}  Success: ${success}  Rejected: ${rejected}  Failed: ${failed}`);
    console.log(`  Categories hit: ${Object.keys(categoryHits).length}  Avg sessions/category: ${(personas.length / categoryNames.length).toFixed(1)}`);
    console.log(`  Total decisions: ${totalDecisions}  Avg coverage: ${avgCoverage}%`);
    console.log("");

    grandTotal += success + rejected + failed;
    grandSuccess += success;
    grandRejected += rejected;
    grandFailed += failed;
  }

  console.log("=== Final Summary ===");
  console.log(`Total sent: ${grandTotal}  Success: ${grandSuccess}  Rejected: ${grandRejected}  Failed: ${grandFailed}`);
  console.log(
    `Expected checkpoints in DB: ~${totalBaseCheckpoints + Math.round(totalDiscoverable * 0.4)} (${totalBaseCheckpoints} base + discoveries)`
  );
}

main().catch(console.error);
