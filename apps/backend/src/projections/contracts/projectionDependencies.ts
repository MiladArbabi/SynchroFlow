export type ProjectionDependency = {
  projection: string;
  dependsOn?: string[];
};

export const projectionDependencies: ProjectionDependency[] = [

  {
    projection: 'orderFulfillmentProjection'
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