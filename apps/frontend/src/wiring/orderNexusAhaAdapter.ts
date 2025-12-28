import { useUiEvents } from 'analytics/useUiEvents';
import { useNavigate } from 'react-router-dom';
import { setFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import type { OrderNexusUiIntent } from '@lasyncro/order-nexus';

export function useOrderNexusAhaAdapter() {
  const { emit } = useUiEvents();
  const navigate = useNavigate();

  return (intent: OrderNexusUiIntent) => {
    if (intent.type === 'START_ONBOARDING') {
      // 1️⃣ Set experience focus
      setFt1ChecklistFocus({
        moduleId: 'order-nexus',
      });

      // 2️⃣ Navigate to FT1 surface
      navigate('/ft1'); // keep route canonical

      // 3️⃣ Emit analytics
      emit({
        event: 'ui.intent',
        payload: {
          action: 'start_onboarding',
          surface: 'order_nexus_aha',
          moduleId: 'order-nexus',
        },
      });
    }
  };
}
