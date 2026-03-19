export type ProjectionDependency = {
  projection: string;
  dependsOn?: string[];
};

export const projectionDependencies: ProjectionDependency[] = [

  {
    projection: 'orderFulfillmentProjection'
  },

  {
    /**
     * CUSTOMER CONSTRAINT PROJECTION
     * --------------------------------
     * Depends on fulfillment baseline state
     */
    projection: 'orderCustomerConstraintProjection',
    dependsOn: ['orderFulfillmentProjection']
  },

  {
    /**
     * OPERATIONAL CONSTRAINT PROJECTION
     * ---------------------------------
     * Depends on fulfillment + age snapshot inputs.
     *
     * NOTE:
     * - orderAgeProjection is required for SLA computation
     */
    projection: 'orderOperationalConstraintProjection',
    dependsOn: ['orderFulfillmentProjection', 'orderAgeProjection']
  },

  {
    projection: 'orderConstraintProjection'
  },

  {
    projection: 'orderMarginProjection',
    dependsOn: ['orderFulfillmentProjection']
  },

  {
    projection: 'orderRiskProjection',
    dependsOn: [
      'orderMarginProjection',
      'orderConstraintProjection'
    ]
  },

  {
    projection: 'orderAgeProjection',
    dependsOn: ['orderFulfillmentProjection']
  },

  {
    projection: 'orderRevenueDailyProjection',
    dependsOn: ['orderMarginProjection']
  },

  {
    projection: 'dailyOperationalBriefProjection',
    dependsOn: [
      'orderRiskProjection',
      'orderRevenueDailyProjection'
    ]
  }

];