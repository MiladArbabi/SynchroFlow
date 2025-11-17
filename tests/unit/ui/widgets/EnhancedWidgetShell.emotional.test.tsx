// tests/unit/ui/widgets/EnhancedWidgetShell.emotional.test.tsx
import { EnhancedWidgetShell } from 'components/widgets/EnhancedWidgetShell';
import { renderWithTheme, createEnhancedWidgetProps } from 'test-utils';
import { EcommerceBusinessContext } from 'components/widgets/types';

describe('EnhancedWidgetShell Emotional Status Borders', () => {
  describe('Emotional Border Logic', () => {
    test('should show urgent red border for survival stage', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'survival',
        revenueBand: '100k',
        burningPriority: 'inventory',
        timeContext: 'realtime'
      };

      const urgentProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...urgentProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626');
    });

    test('should show urgent red border for cash-flow burning priority', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'growth', 
        revenueBand: '100k',
        burningPriority: 'cash-flow',
        timeContext: 'realtime'
      };

      const urgentProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...urgentProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626');
    });

    test('should show no border for growth stage with acquisition priority', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'growth',
        revenueBand: '1M',
        burningPriority: 'acquisition',
        timeContext: 'realtime'
      };

      const neutralProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...neutralProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: none');
    });

    test('should show no border for architect stage with innovation priority', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'architect',
        revenueBand: '50M+',
        burningPriority: 'innovation',
        timeContext: 'quarterly'
      };

      const neutralProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...neutralProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: none');
    });

    test('should show urgent border when both survival stage and cash-flow priority', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'survival',
        revenueBand: '100k',
        burningPriority: 'cash-flow',
        timeContext: 'realtime'
      };

      const criticalProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...criticalProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626');
    });

    test('should show urgent border for survival stage with team priority', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'survival',
        revenueBand: '100k',
        burningPriority: 'team',
        timeContext: 'realtime'
      };

      const urgentProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...urgentProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626');
    });

    test('should use theme error color for urgent borders', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'survival',
        revenueBand: '100k',
        burningPriority: 'inventory',
        timeContext: 'realtime'
      };

      const urgentProps = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...urgentProps} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626');
    });
  });

  describe('Business Context Data Attributes', () => {
    test('should include data-stage attribute for all business contexts', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'survival',
        revenueBand: '100k',
        burningPriority: 'cash-flow',
        timeContext: 'realtime'
      };

      const props = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...props} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveAttribute('data-stage', 'survival');
    });

    test('should include data-revenue-band attribute when provided', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'growth',
        revenueBand: '1M',
        burningPriority: 'acquisition',
        timeContext: 'realtime'
      };

      const props = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...props} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveAttribute('data-revenue-band', '1M');
    });

    test('should handle missing optional business context properties', () => {
      const minimalBusinessContext: Partial<EcommerceBusinessContext> = {
        stage: 'growth'
        // revenueBand and burningPriority are optional
      };

      const props = {
        ...createEnhancedWidgetProps(),
        businessContext: minimalBusinessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...props} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveAttribute('data-stage', 'growth');
      expect(widgetRoot).toHaveStyle('border-left: none'); // Should be neutral without urgent conditions
    });
  });

  describe('Emotional Border Edge Cases', () => {
    test('should handle undefined burningPriority with survival stage', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        stage: 'survival',
        revenueBand: '100k'
        // burningPriority is undefined
      };

      const props = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...props} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626'); // Survival stage alone triggers urgent
    });

    test('should handle undefined stage with cash-flow burningPriority', () => {
      const businessContext: Partial<EcommerceBusinessContext> = {
        revenueBand: '100k',
        burningPriority: 'cash-flow'
        // stage is undefined
      };

      const props = {
        ...createEnhancedWidgetProps(),
        businessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...props} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: 4px solid #DC2626'); // Cash-flow priority alone triggers urgent
    });

    test('should handle completely empty business context', () => {
      const emptyBusinessContext: Partial<EcommerceBusinessContext> = {};

      const props = {
        ...createEnhancedWidgetProps(),
        businessContext: emptyBusinessContext
      };

      const { container } = renderWithTheme(<EnhancedWidgetShell {...props} />);
      
      const widgetRoot = container.firstChild as HTMLElement;
      expect(widgetRoot).toHaveStyle('border-left: none'); // No urgent conditions
    });
  });
});