const R = require('ramda')
const axios = require('axios');

const { typeDefs: productTypeDefs, query: productQuery } = require('./node_modules/ti2/controllers/graphql-schemas/product');
const { typeDefs: availTypeDefs, query: availQuery } = require('./node_modules/ti2/controllers/graphql-schemas/availability');
const { typeDefs: bookingTypeDefs, query: bookingQuery } = require('./node_modules/ti2/controllers/graphql-schemas/booking');
const { typeDefs: rateTypeDefs, query: rateQuery } = require('./node_modules/ti2/controllers/graphql-schemas/rate');
const { typeDefs: pickupTypeDefs, query: pickupQuery } = require('./node_modules/ti2/controllers/graphql-schemas/pickup-point');
const rmsBooking = require('./__apiReference__/booking.json');

const typeDefsAndQueries = {
  productTypeDefs,
  productQuery,
  availTypeDefs,
  availQuery,
  bookingTypeDefs,
  bookingQuery,
  rateTypeDefs,
  rateQuery,
  pickupTypeDefs,
  pickupQuery,
};

describe('auth tests', () => {
  let app;
  const token = {
    clientId: process.env.ti2_rms_clientId,
    clientPassword: process.env.ti2_rms_clientPassword,
  };
  beforeAll(async () => {
    const ti2 = await require('ti2')({
      plugins: {
        rms: require('./index'),
      },
      startServer: false,
    });
    app = ti2.plugins.find((plugin) => plugin.name === 'rms');
  });
  it('should validate an invalid token is ', async () => {
    const isValid = await app.validateToken({
      axios,
      token: {
        clientId: '123',
        clientPassword: 'bull-passw',
      }
    });
    expect(isValid).toBe(false);
  });
  it('should validate an valid token', async () => {
    const isValid = await app.validateToken({
      axios,
      token, 
    });
    expect(isValid).toBe(true);
  });
  it('should be able to get a list of affiliates', async () => {
    const { affiliates } = await app.getAffiliates({
      axios,
      token,
    });
    expect(Array.isArray(affiliates)).toBe(true);
  }, 30e3);
  it('should be able to get a list or booking fields', async () => {
    let testProduct = {
      productName: 'Test property 1',
    };
    const retVal = await app.getCreateBookingFields({
      axios,
      token,
      typeDefsAndQueries,
    });
    expect(Array.isArray(retVal.productFields)).toBeTruthy();
    expect(retVal.productFields.length).toBe(8);
    expect(retVal.productFields.map(p => p.id)).toMatchSnapshot();
    expect(retVal.productFields[0].options.find(o => o.label === testProduct.productName)).toBeTruthy();
  }, 30e3);
  it('should be able to translate a booking', async () => {
    const booking = await app._translateBooking({
      axios,
      rmsBooking,
      token,
      bookingTypeDefs,
      bookingQuery,
    })
    expect(booking).toMatchSnapshot();
  });
});
