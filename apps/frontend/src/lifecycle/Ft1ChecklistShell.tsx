// apps/frontend/src/lifecycle/Ft1ChecklistShell.tsx
import React, { useEffect, useRef } from 'react';
import { useUiEvents } from 'analytics/useUiEvents';
import { Accordion } from 'ui-component/extended/Accordion';
import { consumeFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import { clearFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import 'ui/ft1-checklist/ft1Checklist.css';

interface ChecklistTask {
  id: string;
  label: string;
  completed: boolean;
}

interface ChecklistModule {
  moduleId: string;
  title: string;
  tasks: ChecklistTask[];
}

interface Ft1ChecklistShellProps {
  checklist: {
    modules: ChecklistModule[];
  };
}

/**
 * Ft1ChecklistShell
 * -----------------
 * Structural shell for FT1 onboarding checklist.
 *
 * HARD RULES:
 * - No lifecycle awareness
 * - No entitlement awareness
 * - No theme branching
 * - No routing
 * - Emits generic UI intent events only
 */
export function Ft1ChecklistShell({ checklist }: Ft1ChecklistShellProps) {
  const { emit } = useUiEvents();
  const focus = consumeFt1ChecklistFocus();
  const focusedTaskRef = useRef<HTMLLIElement | null>(null);

  const handleTaskClick = (moduleId: string, taskId: string) => {
    emit({
      event: 'ui.intent',
      payload: {
        action: `task_click:${taskId}`,
        surface: 'ft1_checklist',
        moduleId,
        taskId,
      },
    });
    clearFt1ChecklistFocus();
  };

  useEffect(() => {
    if (focusedTaskRef.current) {
      focusedTaskRef.current.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      });
    }
  }, []);

  return (
    <section 
      data-testid="ft1-checklist-shell"
      className="ft1-checklist"
    >
      <Accordion
      toggle
        defaultExpandedId={focus?.moduleId ?? null}
        data={checklist.modules.map(module => ({
          id: module.moduleId,
          title: module.title,
          focused: focus?.moduleId === module.moduleId,
          content: (
            <ul>
              {module.tasks.map(task => {
                const isFocused =
                  focus?.moduleId === module.moduleId &&
                  focus?.taskId === task.id;

                return (
                  <li
                    key={task.id}
                    ref={isFocused ? focusedTaskRef : undefined}
                    data-focused-task={isFocused ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        handleTaskClick(module.moduleId, task.id)
                      }
                    >
                      {task.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          ),
        }))}
      />
    </section>
  );
}
