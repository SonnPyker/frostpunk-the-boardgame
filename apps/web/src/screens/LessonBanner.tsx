// The lesson panel over the game of a tutorial lesson. It reads the lesson's progress from the engine state (flags.lesson):
// the current step, the steps still to go, the completion card and the way out. It never answers a decision: the engine
// refuses the answers that are not the step's own, and the decision panel shows the choices as usual.
import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import { LESSONS, type LessonProgress } from '../controller/engineApi';
import { useSession } from '../store/session';
import { useTutorial } from '../store/tutorial';
import { useUi } from '../store/ui';
import { t, tn } from '../i18n';

export function LessonBanner() {
  const state = useSession((s) => s.snap?.state ?? null);
  const startLesson = useSession((s) => s.startLesson);
  const detach = useSession((s) => s.detach);
  const setScreen = useUi((s) => s.setScreen);
  const markDone = useTutorial((s) => s.markDone);
  // the lesson the player chose to play on from after its completion card
  const [freeOf, setFreeOf] = useState<string | null>(null);

  const progress = (state?.flags?.lesson as LessonProgress | undefined) ?? null;
  const index = progress ? LESSONS.findIndex((l) => l.id === progress.id) : -1;
  const def = index >= 0 ? LESSONS[index] : null;
  const finished = progress?.done === true;

  useEffect(() => {
    if (finished && def) markDone(def.id);
  }, [finished, def, markDone]);

  if (!progress || !def) return null;

  const exit = () => {
    detach();
    setScreen('tutorial');
  };

  if (finished) {
    if (freeOf === def.id) {
      return (
        <div className="lesson-done lesson-done--chip">
          <Button variant="ghost" size="sm" onClick={exit}>
            {tn('Back to lessons')}
          </Button>
        </div>
      );
    }
    const next = LESSONS[index + 1];
    return (
      <div className="lesson-done" role="dialog" aria-label={t('Lesson complete')}>
        <p className="label-caps">{tn('Lesson complete')}</p>
        <h2 className="lesson-done__title">{tn(def.title)}</h2>
        <p className="lesson-done__summary">{tn(def.summary)}</p>
        <div className="lesson-done__actions">
          {next ? (
            <Button variant="primary" onClick={() => startLesson(next.id)}>
              {tn('Next lesson')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={exit}>
            {tn('Back to lessons')}
          </Button>
          <Button variant="ghost" onClick={() => setFreeOf(def.id)}>
            {tn('Keep playing freely')}
          </Button>
        </div>
      </div>
    );
  }

  const step = def.steps[progress.step];
  return (
    <aside className="lesson-banner" aria-label={t('Tutorial')}>
      <div className="lesson-banner__head">
        <span className="label-caps">
          {tn('Tutorial')} · {t(`Lesson ${index + 1} of ${LESSONS.length}`)}
        </span>
        <span className="lesson-banner__title">{tn(def.title)}</span>
        <Button variant="ghost" size="sm" onClick={exit}>
          {tn('Leave lesson')}
        </Button>
      </div>
      <p className="lesson-banner__step">
        <span className="label-caps lesson-banner__count">{t(`Step ${progress.step + 1} of ${def.steps.length}`)}</span>
        <span>{tn(step.text)}</span>
      </p>
      <ol className="lesson-banner__dots" aria-hidden="true">
        {def.steps.map((st, i) => (
          <li key={i} data-state={i < progress.step ? 'done' : i === progress.step ? 'current' : 'todo'} />
        ))}
      </ol>
    </aside>
  );
}
