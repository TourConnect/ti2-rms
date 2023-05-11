const { makeExecutableSchema } = require('@graphql-tools/schema');
const { graphql } = require('graphql');
const R = require('ramda');
const jwt = require('jsonwebtoken');

const resolvers = {
  Query: {
    key: (root, args) => {
      const {
        productId,
        optionId,
        currency,
        unitsWithQuantity,
        jwtKey,
      } = args;
      if (!jwtKey) return null;
      return jwt.sign(({
        productId,
        optionId,
        availabilityId: root.pk,
        currency,
        customers: R.chain(u => {
          const foundCustomerTypeRate = root.customer_type_rates.find(c => `${R.path(['customer_prototype', 'pk'], c)}` === `${u.unitId}`) || {};
          return new Array(u.quantity).fill(1).map(() => ({
            customer_type_rate: foundCustomerTypeRate.pk,
          }));
        }, unitsWithQuantity).filter(c => c.customer_type_rate),
      }), jwtKey);
    },
    dateTimeStart: root => R.path(['start_at'], root),
    dateTimeEnd: root => R.path(['end_at'], root),
    allDay: () => false,
    vacancies: R.prop('capacity'),
    available: () => true,
    // get the starting price
    pricing: root => {
      // sort ascending
      const sorted = R.sort(R.ascend(R.path(['customer_prototype', 'total_including_tax'])), root.customer_type_rates);
      return sorted[0];
    },
    unitPricing: root => R.path(['customer_type_rates'], root),
    pickupAvailable: root => Boolean(root.lodgings && root.lodgings.some(l => l.is_pickup_available)),
    pickupRequired: () => false,
    pickupPoints: root => R.pathOr([], ['lodgings'], root)
    .map(l => ({
      id: R.prop('pk', l),
      name: R.prop('name', l),
      pickupAvail: R.prop('is_pickup_available', l)
    }))
  },
  Pricing: {
    unitId: R.path(['customer_prototype', 'pk']),
    original: R.path(['customer_prototype', 'total_including_tax']),
    retail: R.path(['customer_prototype', 'total_including_tax']),
    net: R.path(['customer_prototype', 'total_including_tax']),
    currencyPrecision: () => 2,
  },
};


const translateAvailability = async ({ rootValue, variableValues, typeDefs, query }) => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  })
  const retVal = await graphql({
    schema,
    rootValue,
    source: query,
    variableValues,
  });
  if (retVal.errors) throw new Error(retVal.errors);
  return retVal.data;
};
module.exports = {
  translateAvailability,
};
