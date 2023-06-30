const { makeExecutableSchema } = require('@graphql-tools/schema');
const { graphql } = require('graphql');
const R = require('ramda');
const jwt = require('jsonwebtoken');

const resolvers = {
  Query: {
    key: (root, { jwtKey }) => {
      if (!jwtKey) return null;
      return jwt.sign(root, jwtKey);
    },
    dateTimeStart: ({ dateTimeStart }) => dateTimeStart,
    dateTimeEnd: ({ dateTimeEnd }) => dateTimeEnd,
    allDay: () => true,
    available: () => true,
    // get the starting price
    pricing: ({ totalPricing }) => {
      if (!totalPricing) return null;
      return {
        original: totalPricing,
        retail: totalPricing,
        net: totalPricing,
      };
    },
    unitPricing: () => [],
    pickupAvailable: () => false,
    pickupRequired: () => false,
    pickupPoints: () => [],
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
