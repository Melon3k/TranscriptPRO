import { useState, useEffect } from "react";
import { Download, Loader2, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useSettingsStore, type UiLanguage } from "../../stores/settingsStore";
import { listModels, downloadModel } from "../../lib/tauri-commands";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import type { WhisperModelInfo } from "../../types/subtitle";
import ApiKeyField from "../Settings/ApiKeyField";

// ── Step indicators ───────────────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current
              ? "w-4 bg-blue-500"
              : i < current
              ? "w-1.5 bg-blue-300 dark:bg-blue-700"
              : "w-1.5 bg-gray-300 dark:bg-gray-600"
          }`}
        />
      ))}
    </div>
  );
}

// ── Step 0: Welcome ───────────────────────────────────────────────────────────

function WelcomeStep() {
  const { t } = useTranslation(["onboarding", "settings"]);
  const { language, setLanguage } = useSettingsStore();

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="text-4xl">🎙️</div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t("onboarding:welcome.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          {t("onboarding:welcome.subtitle")}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("settings:language.label")}
        </label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as UiLanguage)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {SUPPORTED_LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>
              {t(`settings:language.${lng}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Step 1: Model ─────────────────────────────────────────────────────────────

function ModelStep({ onDownloaded }: { onDownloaded: (ok: boolean) => void }) {
  const { t } = useTranslation(["onboarding", "transcription"]);
  const { whisperModel, setWhisperModel } = useSettingsStore();

  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        onDownloaded(m.some((x) => x.downloaded));
      })
      .catch(() => {});
  }, []);

  const selectedModel = models.find((m) => m.name === whisperModel);
  const anyDownloaded = models.some((m) => m.downloaded);

  const handleDownload = async () => {
    setDownloading(true);
    setProgress(0);
    setError(null);
    try {
      await downloadModel(whisperModel, (p) => setProgress(p));
      const updated = await listModels();
      setModels(updated);
      onDownloaded(updated.some((x) => x.downloaded));
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("onboarding:model.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          {t("onboarding:model.subtitle")}
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("transcription:modelLabel")}
        </label>
        <select
          value={whisperModel}
          onChange={(e) => setWhisperModel(e.target.value)}
          disabled={downloading}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.sizeMb} MB){m.downloaded ? " ✓" : ""}
            </option>
          ))}
        </select>

        {selectedModel && !selectedModel.downloaded && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 w-full justify-center rounded bg-gray-100 dark:bg-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            {downloading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("transcription:downloading", { percent: Math.round(progress * 100) })}
              </>
            ) : (
              <>
                <Download size={14} />
                {t("transcription:downloadModel", { sizeMb: selectedModel.sizeMb })}
              </>
            )}
          </button>
        )}

        {downloading && (
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {anyDownloaded && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 size={13} />
            {selectedModel?.downloaded
              ? `${selectedModel.name} ready`
              : "A model is ready"}
          </div>
        )}

        {error && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

// ── Step 2: API keys ──────────────────────────────────────────────────────────

function ApiKeysStep() {
  const { t } = useTranslation(["onboarding", "settings"]);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("onboarding:apiKeys.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          {t("onboarding:apiKeys.subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        <ApiKeyField
          provider="gemini"
          label={t("settings:geminiApiKey")}
          placeholder="AIzaSy..."
        />
        <ApiKeyField
          provider="claude"
          label={t("settings:claudeApiKey")}
          placeholder="sk-ant-api03-..."
        />
      </div>
    </div>
  );
}

// ── Step 3: Done ──────────────────────────────────────────────────────────────

function DoneStep() {
  const { t } = useTranslation(["onboarding"]);
  return (
    <div className="space-y-4 text-center">
      <div className="text-5xl">🎉</div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        {t("onboarding:done.title")}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed bg-blue-50 dark:bg-blue-900/20 rounded-lg px-4 py-3 border border-blue-100 dark:border-blue-800">
        {t("onboarding:done.tip")}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("onboarding:done.settingsHint")}
      </p>
    </div>
  );
}

// ── Wizard shell ──────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

export default function OnboardingWizard() {
  const { t } = useTranslation(["onboarding"]);
  const { markComplete } = useOnboardingStore();

  const [step, setStep] = useState(0);
  const [modelReady, setModelReady] = useState(false);

  const canNext =
    step === 0 ||
    step === 2 ||
    step === 3 ||
    (step === 1 && modelReady);

  function handleNext() {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
    else markComplete();
  }

  function handleBack() {
    setStep((s) => s - 1);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <StepDots total={TOTAL_STEPS} current={step} />
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t("onboarding:step", { current: step + 1, total: TOTAL_STEPS })}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 pb-4 min-h-[260px]">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <ModelStep onDownloaded={setModelReady} />}
          {step === 2 && <ApiKeysStep />}
          {step === 3 && <DoneStep />}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            {step > 0 && step < TOTAL_STEPS - 1 && (
              <button
                onClick={handleBack}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                ← {t("onboarding:back")}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={handleNext}
                className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {t("onboarding:apiKeys.skip")}
              </button>
            )}
            {step === 1 && !canNext && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {t("onboarding:model.nextBlocked")}
              </span>
            )}
            <button
              onClick={handleNext}
              disabled={!canNext}
              className="rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2 text-sm font-medium text-white transition-colors"
            >
              {step === TOTAL_STEPS - 1
                ? t("onboarding:finish")
                : t("onboarding:next") + " →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
