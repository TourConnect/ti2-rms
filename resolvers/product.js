const { makeExecutableSchema } = require('@graphql-tools/schema');
const R = require('ramda');
const { graphql } = require('graphql');

const resolvers = {
  Query: {
    productId: R.path(['id']),
    productName: R.path(['name']),
    availableCurrencies: obj => {
      const [secondary, primary] = [
        R.path(['currencies'], 'primaryCurrencyName', obj),
        R.path(['currencies'], 'secondaryCurrencyName', obj),
      ];
      return R.filter(Boolean, [primary, secondary]);
    },
    defaultCurrency: item => {
      if (R.path(['secondaryCurrencyName', 'currencies'], item)) {
        return R.path(['primaryCurrencyName', 'currencies'], item);
      }
    },
    options: item => {
      return R.pathOr([], ['options'], item).map(option => ({
        optionId: R.path(['id'], option),
        optionName: R.path(['name'], option),
        units: [{
          unitId: 'occupants',
          unitName: 'Occupants',
          restrictions: {
            paxCount: R.path(['maxOccupantsPerCategory'], option)
          },
        }],
      }));
    },
  },
};

const translateProduct = async ({
  rootValue,
  typeDefs,
  query,
}) => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });
  const retVal = await graphql({
    schema,
    rootValue,
    source: query,
  });
  if (retVal.errors) throw new Error(retVal.errors);
  return retVal.data;
};

module.exports = {
  translateProduct,
};
