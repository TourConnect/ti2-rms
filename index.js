const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');

const { translateProduct } = require('./resolvers/product');
const { translateAvailability } = require('./resolvers/availability');
const { translateBooking } = require('./resolvers/booking');
const { translatePickupPoint } = require('./resolvers/pickup-point');

const CONCURRENCY = 3; // is this ok ?

const getHeaders = ({
  authToken,
}) => ({
  ...authToken ? { 'authtoken': authToken } : {},
  'Content-Type': 'application/json',
  accept: 'application/json',
});

class Plugin {
  constructor(params) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
    if (this.events) {
    }
    const pluginObj = this;
    this.tokenTemplate = () => ({
      agentId: {
        type: 'text',
        regExp: /[0-9]/,
        description: 'Agent id',
      },
      agentPassword: {
        type: 'text',
        regExp: /(.*)+/,
        description: 'Agent Password',
      },
      clientId: {
        type: 'text',
        regExp: /[0-9]/,
        description: 'RMS Client id',
      },
      clientPassword: {
        type: 'text',
        regExp: /(.*)+/,
        description: 'RMS Client password',
      },
      server: {
        type: 'text',
        regExp: /^(?!mailto:)(?:(?:http|https|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?:(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[0-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))|localhost)(?::\d{2,5})?(?:(\/|\?|#)[^\s]*)?$/i,
        description: 'The RMS server\'s url',
      },
    });
  }
  async _getCreds({
    axios,
    agentId = this.agentId,
    agentPassword = this.agentPassword,
    clientId,
    clientPassword,
    server = this.server,
  }) {
    const clientUrl = await this.cache.getOrExec({
      fnParams: [{
        server,
        clientId,
      }],
      fn: async ({ server, clientId }) => {
        return R.path(['data'], await axios({
          method: 'get',
          url: `${server}/clienturl/${clientId}`,
        }));
      },
    });
    // javascript test a regex extpresion
    assert(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/.test(clientUrl));
    // now obtain an authentication token
    const authToken = await this.cache.getOrExec({
      fnParams: [{
        agentId,
        agentPassword,
        clientUrl,
        clientId,
        clientPassword,
        moduleType: ['pointOfSale'],
      }],
      fn: async params => {
        const data = R.omit(['clientUrl'], params); 
        return R.path(['data', 'token'], await axios({
          method: 'post',
          url: `${clientUrl}/authToken`,
          data, 
        }));
      },
    });
    assert(authToken);
    return { clientUrl, authToken };
  }
  async validateToken({
    axios,
    token,
  }) {
    try {
      await this._getCreds({ ...token, axios });
      return true;
    } catch (err) {
      console.log({ err });
      return false;
    }
  }

  async getAffiliateAgents({
    axios,
    token,
  }) {
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
      console.log("authToken", authToken);
    const headers = getHeaders({
      authToken,
    });
    const agents = [];
    let currentResults = new Array(100).fill({});
    let offset = 0;
    while (currentResults.length === 100) {
      currentResults = R.pathOr([], ['data'], await axios({
        method: 'post',
        url: `${clientUrl}/agents/search?limit=100&offset=${offset}`,
        headers,
        data: { inactive: false },
      }));
      if (currentResults.length > 0) {
        agents.push(...currentResults);
      }
      offset += 100;
    }
    return ({ agents });
  }

  async searchProducts({
    axios,
    token,
    payload,
    typeDefsAndQueries: {
      productTypeDefs,
      productQuery,
    },
  }) {
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    let url = `${clientUrl}/properties?modelType=full`;
    let results = R.pathOr([], ['data'], await axios({
      method: 'get',
      url,
      headers,
    }));
    // get all currency options
    const products = await Promise.mapSeries(results, async product => {
      const currencies = R.path(['data'], await axios({
        method: 'get',
        url: `${clientUrl}/properties/${product.id}/currency`,
        headers,
      }));

      // product getter
      const options = [];
      let currentResults = new Array(100).fill({});
      let offset = 0;
      while (currentResults.length === 100) {
        currentResults = R.pathOr([], ['data'], await axios({
          method: 'get',
          url: `${clientUrl}/categories?propertyId=${product.id}&offset=${offset}&modelType=full`,
          headers,
        }));
        if (currentResults.length > 0) {
          options.push(...currentResults);
        }
        offset += 100;
      }
      return translateProduct({
        rootValue: { ...product, currencies, options },
        typeDefs: productTypeDefs,
        query: productQuery,
      });
    });
    // // dynamic extra filtering
    // if (!isNilOrEmpty(payload)) {
    //   const extraFilters = R.omit([], payload);
    //   if (Object.keys(extraFilters).length > 0) {
    //     products = products.filter(
    //       product => Object.entries(extraFilters).every(
    //         ([key, value]) => {
    //           if (typeof value === 'string') return wildcardMatch(value, product[key]);
    //           if (key === 'productId') return `${product.productId}` === `${value}`;
    //           return true;
    //         },
    //       ),
    //     );
    //   }
    // }
    return ({ products, results });
  }

}

module.exports = Plugin;

