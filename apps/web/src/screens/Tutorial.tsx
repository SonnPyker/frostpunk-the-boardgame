// Tutorial menu: the prepared lessons (engine tutorial.ts), each one a short position of the Crater game that teaches one
// mechanic. Finished lessons are marked. Starting a lesson switches App to the game view, with the lesson panel on top.
import { Button } from '../components/ui';
import { LESSONS } from '../controller/engineApi';
import { useSession } from '../store/session';
import { useTutorial } from '../store/tutorial';
import { useUi } from '../store/ui';
import { Backdrop } from './Backdrop';
import { t, tn } from '../i18n';

export function Tutorial() {
  const setScreen = useUi((s) => s.setScreen);
  const startLesson = useSession((s) => s.startLesson);
  const done = useTutorial((s) => s.done);

  return (
    <div className="setup tutorial">
      <Backdrop intensity={0.7} />
      <div className="setup__form tutorial__form">
        <header className="setup__head">
          <Button variant="ghost" icon="close" size="sm" onClick={() => setScreen('menu')} aria-label={t('Back to menu')}>
            {tn('Back')}
          </Button>
          <h1 className="setup__title">{tn('Tutorial')}</h1>
          <span className="setup__head-spacer" />
        </header>

        <p className="tutorial__intro">
          {tn('Short lessons on a prepared Crater board. Each one teaches one rule. Follow the step on screen: only the answer it asks for is accepted.')}
        </p>

        <ol className="tutorial__grid" aria-label={t('Lessons')}>
          {LESSONS.map((lesson, i) => (
            <li key={lesson.id}>
              <button type="button" className="lesson-card" onClick={() => startLesson(lesson.id)}>
                <span className="lesson-card__no label-caps">{t(`Lesson ${i + 1}`)}</span>
                <span className="lesson-card__title">{tn(lesson.title)}</span>
                <span className="lesson-card__summary">{tn(lesson.summary)}</span>
                <span className="lesson-card__meta">
                  <span>{t(`${lesson.steps.length} steps`)}</span>
                  <span>
                    {t('Rulebook pages')} {lesson.rulebook.replace(/p(?=\d)/g, '')}
                  </span>
                  {done.includes(lesson.id) ? <span className="lesson-card__done">{tn('Completed')}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <p className="muted setup__note">
          {tn('Lesson progress is kept in this browser only. Your saved game is not changed.')}
        </p>
      </div>
    </div>
  );
}
