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
      return R.pathOr([], ['agentRates'], item).map(agentRate => ({
        optionId: R.path(['rateId'], agentRate),
        optionName: R.path(['rateName'], agentRate),
        units: R.pathOr([], ['categories'], item).map(category => ({
          unitId: category.id,
          unitName: category.name,
          restrictions: {
            paxCount: R.path(['maxOccupantsPerCategory'], category)
          },
        })),
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
