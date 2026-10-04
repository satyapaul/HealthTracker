import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ArrowRightIcon, CheckCircleIcon } from '../../ui';
import { useSession } from '../../auth/useSession';
import { followupApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { HospitalPicker, type HospitalChoice } from '../../features/followup/HospitalPicker';
import { WizardHeader, type WizardStep } from '../../features/followup/WizardHeader';
import { LabsStep, MedsStep, ReviewStep } from '../../features/followup/WizardSteps';
import {
  emptyWizardState,
  hasAnyLab,
  toCreateBody,
  type WizardState,
} from '../../features/followup/wizard-state';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Submit Follow-Up — the 3-step patient wizard (Labs -> Meds -> Review).
 *
 * Flow: the patient must pick an engagement hospital first (v1.7 requirement);
 * then enters labs, meds/doses/weight/notes, reviews, and submits. Submit
 * creates a draft row (POST /followup/rows) and immediately submits it
 * (PUT .../submit). The required-hospital and "at least one lab" rules are
 * enforced client-side for fast feedback; the API is the authority and its
 * errors surface inline.
 */
export function SubmitFollowUpPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [step, setStep] = useState<WizardStep>(1);
  const [state, setState] = useState<WizardState>(() => emptyWizardState(todayIso()));
  // Open the picker up-front when no hospital is chosen yet.
  const [pickerOpen, setPickerOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patientId = session?.patientId ?? '';

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  const onConfirmHospital = (choice: HospitalChoice) => {
    update({ engagementHospitalId: choice.id, engagementHospitalName: choice.name });
    setPickerOpen(false);
  };

  const next = () => {
    setError(null);
    if (step === 1 && !hasAnyLab(state)) {
      setError('Enter at least one lab value before continuing.');
      return;
    }
    setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s));
  };

  const back = () => {
    if (step === 1) {
      navigate(-1);
      return;
    }
    setStep((s) => (s - 1) as WizardStep);
  };

  const onSubmit = async () => {
    setError(null);
    if (!state.engagementHospitalId) {
      setPickerOpen(true);
      setError('Select a follow-up hospital before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const draft = await followupApi.createDraft(toCreateBody(state));
      await followupApi.submit(draft.id);
      navigate('/app/chart', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column' }}>
        <WizardHeader
          current={step}
          hospitalName={state.engagementHospitalName}
          onBack={back}
          onJumpTo={setStep}
        />

        <main style={{ flex: 1, padding: '20px 20px 120px' }}>
          {step === 1 && (
            <LabsStep
              state={state}
              onLabChange={(key, value) => update({ labs: { ...state.labs, [key]: value } })}
              onAttach={() =>
                // Presign upload lands in a later WP; stub a filename for now.
                update({ attachedFileName: state.attachedFileName ? null : 'Lab_Report.pdf' })
              }
            />
          )}
          {step === 2 && (
            <MedsStep
              state={state}
              onDrugLevelChange={(key, value) =>
                update({ drugLevels: { ...state.drugLevels, [key]: value } })
              }
              onDoseChange={(key, value) => update({ doses: { ...state.doses, [key]: value } })}
              onAmPmChange={(key, nextPair) =>
                update({ dosesAmPm: { ...state.dosesAmPm, [key]: nextPair } })
              }
              onWeightChange={(value) => update({ weightKg: value })}
              onNotesChange={(value) => update({ notes: value })}
            />
          )}
          {step === 3 && (
            <ReviewStep state={state} onEditLabs={() => setStep(1)} onEditMeds={() => setStep(2)} />
          )}

          {error && (
            <p role="alert" style={{ color: 'var(--color-danger)', marginTop: '16px' }}>
              {error}
            </p>
          )}
        </main>

        <footer
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            gap: '12px',
            padding: '16px 20px',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          {step > 1 && (
            <Button variant="secondary" size="lg" onClick={back} style={{ flex: 1 }}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button
              size="lg"
              onClick={next}
              style={{ flex: 2 }}
              leading={<ArrowRightIcon size={20} />}
            >
              {step === 1 ? 'Next: Medications' : 'Next: Review'}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={onSubmit}
              disabled={submitting}
              style={{ flex: 2 }}
              leading={<CheckCircleIcon size={20} />}
            >
              {submitting ? 'Submitting…' : 'Submit for Review'}
            </Button>
          )}
        </footer>

        <HospitalPicker
          open={pickerOpen}
          patientId={patientId}
          selectedId={state.engagementHospitalId}
          onClose={() => setPickerOpen(false)}
          onConfirm={onConfirmHospital}
        />
      </div>
    </div>
  );
}
