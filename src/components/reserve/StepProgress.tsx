import { cn } from "@/lib/utils";

const STEP_LABELS = ["日付", "時間", "お客様情報", "確認"];

/** Segment progress indicator for the customer booking wizard. Current step is visually + textually distinct. */
export function StepProgress({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex gap-1.5">
        {STEP_LABELS.map((_, i) => (
          <div key={i} className={cn("h-1.5 flex-1 rounded-full", i <= currentStep ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        ステップ {currentStep + 1}/{STEP_LABELS.length}：{STEP_LABELS[currentStep]}
      </p>
    </div>
  );
}
