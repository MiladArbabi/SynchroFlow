// tests/unit/ui/widgets/widget-registry.test.ts
import { 
  getWidgetsForUser, 
  WIDGET_REGISTRY
} from 'components/widgets/widget-registry';

describe('WidgetRegistry', () => {
  const mockUser = {
    detected_mode: 'survival' as const,
    plan: 'free' as const
  };

  describe('getWidgetsForUser', () => {
    it('should return survival widgets for survival mode users', () => {
      const widgets = getWidgetsForUser(mockUser);
      
      expect(widgets).toHaveLength(3);
      expect(widgets[0].id).toBe('cash-flow');
      expect(widgets[1].id).toBe('inventory-alerts');
      expect(widgets[2].id).toBe('order-metrics');
    });

    it('should filter out paid widgets for free users', () => {
      const freeUser = { ...mockUser, plan: 'free' as const };
      const paidUser = { ...mockUser, plan: 'premium' as const };
      
      const freeWidgets = getWidgetsForUser(freeUser);
      const paidWidgets = getWidgetsForUser(paidUser);
      
      // Free users should have fewer widgets
      expect(freeWidgets).toHaveLength(3); // Free users get 3 widgets (excludes paid)
      expect(paidWidgets).toHaveLength(4); // Paid users get 4 widgets (includes paid)
      // Free widgets should not include paid-only features
      expect(freeWidgets.every(w => !w.requiresPaidPlan)).toBe(true);
    });

    it('should prioritize widgets by urgency in survival mode', () => {
      const widgets = getWidgetsForUser(mockUser);
      
      const priorities = widgets.map(w => w.priority);
      expect(priorities).toEqual(['critical', 'high', 'medium']);
    });

    it('should return empty array for unknown user mode', () => {
      const unknownUser = { ...mockUser, detected_mode: 'unknown' as any };
      
      const widgets = getWidgetsForUser(unknownUser);
      expect(widgets).toEqual([]);
    });
  });

  describe('WIDGET_REGISTRY', () => {
    it('should have widgets defined for all user modes', () => {
      expect(WIDGET_REGISTRY.survival).toBeDefined();
      expect(WIDGET_REGISTRY.growth).toBeDefined();
      expect(WIDGET_REGISTRY.architect).toBeDefined();
    });

    it('should have proper widget configuration', () => {
      const survivalWidgets = WIDGET_REGISTRY.survival;
      
      survivalWidgets.forEach(widget => {
        expect(widget.id).toBeDefined();
        expect(widget.priority).toMatch(/critical|high|medium|low/);
        expect(widget.component).toBeDefined();
        expect(typeof widget.requiresPaidPlan).toBe('boolean');
      });
    });
  });
});