const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');

const { translateProduct } = require('./resolvers/product');
const { translateAvailability } = require('./resolvers/availability');
const { translateBooking } = require('./resolvers/booking');

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
      tourConnectAgentId: {
        type: 'text',
        regExp: /[0-9]/,
        description: 'Agent id (TourConnect)',
      },
      tourConnectAgentPassword: {
        type: 'text',
        regExp: /(.*)+/,
        description: 'Agent Password (TourConnect)',
      },
      server: {
        type: 'text',
        regExp: /(.*)+/,
      },
      agentId: {
        type: 'text',
        regExp: /[0-9]/,
        description: 'Agent id',
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
    this.errorPathsAxiosErrors = () => ([ // axios triggered errors
      ['response', 'data', 'message'],
    ]);
    this.errorPathsAxiosAny = () => ([]); // 200's that should be errors
  }
  async _cacheAxios({ axios, ttl, forceRefresh, ...data }) {
    return this.cache.getOrExec({
      fnParams: [data],
      fn: async () => {
        const ret = await axios(data);
        return {
          data: ret.data,
        };
      },
      ttl: ttl || 60 * 60 * 12, // 12 hours
      forceRefresh,
    });
  }

  async _translateBooking({ axios, rmsBooking, token, bookingTypeDefs, bookingQuery, }) {
    const productFields = await this.cache.get({ key: { ...token, type: 'productFields' } });
    if (!rmsBooking.guest) {
      const {
        clientUrl,
        authToken,
      } = await this._getCreds({ ...token, axios });
      const headers = getHeaders({
        authToken,
      });
      const [guest] = R.path(['data'], await axios({
        method: 'get',
        url: `${clientUrl}/reservations/${rmsBooking.id}/guests`,
        headers,
      }));
      rmsBooking.guest = guest;
    }
    const standardBooking = await translateBooking({
      rootValue: rmsBooking,
      typeDefs: bookingTypeDefs,
      query: bookingQuery,
    });
    const productFieldsValue = (productFields || []).reduce((acc, field) => {
      if (field.id === 'startDate') return { ...acc, [field.id]: rmsBooking.arrivalDate };
      if (field.id === 'endDate') return { ...acc, [field.id]: rmsBooking.departureDate };
      if (field.id === 'rateId') return { ...acc, [field.id]: rmsBooking.rateTypeId };
      return {
        ...acc,
        [field.id]: rmsBooking[field.id],
      };
    }, {});
    return {
      ...standardBooking,
      ...productFieldsValue,
    };
  }
  async _getCreds({
    axios,
    tourConnectAgentId = this.agentId,
    tourConnectAgentPassword = this.agentPassword,
    clientId,
    clientPassword,
    server = this.server,
  }) {
    const clientUrl = await this.cache.getOrExec({
      ttl: 60 * 60 * 12, // 12 hours
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
        agentId: tourConnectAgentId || this.agentId,
        agentPassword: tourConnectAgentPassword || this.agentPassword,
        clientUrl,
        clientId,
        clientPassword,
        moduleType: ['pointOfSale', 'kiosk'],
      }],
      fn: async params => {
        const data = R.omit(['clientUrl'], params);
        return R.path(['data', 'token'], await axios({
          method: 'post',
          url: `${clientUrl}/authToken`,
          data, 
        }));
      },
      ttl: 60 * 60 * 12, // 12 hours
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
      console.log({ err: R.path(['response', 'data', 'message'], err) });
      return false;
    }
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
    return { products: [] }
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    // get all agent rates (agent rates is options)
    const allAgentRates = R.pathOr([], ['data'], await axios({
      method: 'get',
      url: `${clientUrl}/agents/${token.agentId || this.agentId}/rates`,
      headers,
    }));
    let productResults = R.pathOr([], ['data'], await axios({
      method: 'get',
      url: `${clientUrl}/properties?modelType=full`,
      headers,
    }));
    // get all currency options
    const products = await Promise.map(productResults, async property => {
      const currencies = R.path(['data'], await axios({
        method: 'get',
        url: `${clientUrl}/properties/${property.id}/currency`,
        headers,
      }));

      // product getter
      const categories = [];
      let currentResults = new Array(100).fill({});
      let offset = 0;
      while (currentResults.length === 100) {
        currentResults = R.pathOr([], ['data'], await axios({
          method: 'get',
          url: `${clientUrl}/categories?propertyId=${property.id}&offset=${offset}&modelType=full`,
          headers,
        }));
        if (currentResults.length > 0) {
          categories.push(...currentResults);
        }
        offset += 100;
      }
      let agentRates = allAgentRates.filter(ar => ar.propertyId === property.id);
      // console.log(allAgentRates, typeof property.id)
      // do not return products that do not have agent rates
      if (!agentRates.length) return null;
      return translateProduct({
        rootValue: { ...property, currencies, agentRates, categories },
        typeDefs: productTypeDefs,
        query: productQuery,
      });
    });
    return ({ products: products.filter(Boolean) });
  }


  async searchAvailability({
    axios,
    token,
    payload: {
      propertyId,
      startDate,
      endDate,
      categoryId,
      rateId,
      adults,
      children,
      infants,
      dateFormat,
    },
    typeDefsAndQueries: {
      availTypeDefs,
      availQuery,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD 00:00:00');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD 23:59:59');
    if (moment(localDateEnd).isBefore(localDateStart)) {
      throw new Error('Departure date must be after arrival date');
    }
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const payload = {
      dateFrom: localDateStart,
      dateTo: localDateEnd,
      propertyId,
    };
    const [
      { data: availsAxios },
      { data: ratesGridAxios },
      // { data: availAreasAxios },
    ] = await Promise.all([
      this._cacheAxios({
        axios,
        ttl: 30, // 30 seconds
        method: 'POST',
        url: `${clientUrl}/availabilityGrid`,
        headers,
        data: payload,
      }),
      axios({
        method: 'POST',
        url: `${clientUrl}/rates/grid?includeEstimatedRates=false`,
        headers,
        data: {
          ...payload,
          agentId: token.agentId,
          rateIds: [rateId],
          categoryIds: [categoryId],
          arrival: localDateStart,
          departure: localDateEnd,
          adults,
          children,
          infants,
        },
      }),
      // axios({
      //   method: 'post',
      //   url: `${clientUrl}/availableAreas`,
      //   headers,
      //   data: {
      //     ...payload,
      //     agentId: token.agentId,
      //     rateIds: [rateId],
      //     categoryIds: [categoryId],
      //     arrival: localDateStart,
      //     departure: localDateEnd,
      //     useDefaultTimes: true,
      //   },
      // })
    ]);
    const avails = R.call(R.compose(
      R.filter(o => o.count > 0),
      R.propOr([], 'availability'),
      R.find(a => a.id === categoryId),
      R.propOr([], 'categories'),
    ), availsAxios);
    // const availAreas = availAreasAxios.filter(aa => aa.categoryId === categoryId);
    const ratesGrid = R.call(R.compose(
      R.propOr([], 'dayBreakdown'),
      R.find(r => r.rateId === rateId),
      R.propOr([], 'rates'),
      R.find(rg => rg.categoryId === categoryId),
      R.propOr([], 'categories'),
    ), ratesGridAxios);
    if (!avails.length) throw new Error('No availability found for this room type');
    if (avails.length < moment(endDate, dateFormat).diff(moment(startDate, dateFormat), 'days')) {
      throw new Error(`Only these dates have vacancies:\n${
        avails.map(a => `${a.theDate}: ${a.count}`).join(',\n')}
      `);
    }
    // console.log(ratesGridAxios.categories);
    if (!(ratesGrid && ratesGrid.filter(rg => rg.dailyRate).length)) throw new Error('No rates found for this rate type');
    const availability = [[await translateAvailability({
      typeDefs: availTypeDefs,
      query: availQuery,
      rootValue: {
        dateTimeStart: localDateStart,
        dateTimeEnd: localDateEnd,
        vacancies: Math.min(...avails.map(a => a.count)),
        totalPricing: ratesGrid.reduce((total, rg) => {
          return total + (rg.dailyRate || 0)
        }, 0),
      },
      variableValues: {
        jwtKey: this.jwtKey,
      },
    })]];
    return { availability };
  }

  async availabilityCalendar({
    axios,
    token,
    payload: {
      propertyId,
      startDate,
      endDate,
      categoryId,
      dateFormat,
    },
    typeDefsAndQueries: {
      availTypeDefs,
      availQuery,
    },
  }) {
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD 00:00:00');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD 23:59:59');
    if (moment(localDateEnd).isBefore(localDateStart)) {
      throw new Error('Departure date must be after arrival date');
    }
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const payload = {
      dateFrom: localDateStart,
      dateTo: localDateEnd,
      propertyId,
    };
    const { data: availsAxios } = await this._cacheAxios({
      axios,
      ttl: 30, // 30 seconds
      method: 'POST',
      url: `${clientUrl}/availabilityGrid`,
      headers,
      data: payload,
    });
    const avails = R.call(R.compose(
      R.filter(o => o.count > 0),
      R.propOr([], 'availability'),
      R.find(a => a.id === categoryId),
      R.propOr([], 'categories'),
    ), availsAxios);
    return { availability: [await Promise.map(avails, a => {
      return translateAvailability({
        typeDefs: availTypeDefs,
        query: availQuery,
        rootValue: {
          dateTimeStart: a.theDate,
          dateTimeEnd: a.theDate,
          vacancies: a.count,
        },
      });
    })] };
  }
  async searchGuests({
    axios,
    token,
    payload: {
      firstName,
      lastName,
      emailAddress,
      phoneNumber,
      propertyId,
    },
  }) {
    // RMS has very good merging guests functionality
    // so at the moment, we won't be providing this search functionality to front end
    // as we will create guests on the fly during booking creation
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const guests = R.pathOr([], ['data'], await axios({
      method: 'post',
      headers,
      url: `${clientUrl}/guests/search`,
      payload: {
        ...(firstName ? { given: firstName } : {}),
        ...(lastName ? { surname: lastName } : {}),
        ...(emailAddress ? { email: emailAddress } : {}),
        ...(phoneNumber ? { mobile: phoneNumber } : {}),
        ...(propertyId ? { propertyIds: [propertyId] } : {}),
      }
    }));
    return guests.map(guest => ({
      guestId: guest.id,
      firstName: guest.guestGiven,
      lastName: guest.guestSurname,
      emailAddress: guest.email,
      emailAddress2: guest.email2,
      phoneNumber: guest.mobile,
    }));
  }

  async getCreateBookingFields({
    axios,
    token,
    payload: { forceRefresh } = {},
  }) {
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const allProperties = R.pathOr([], ['data'], await axios({
      method: 'get',
      headers,
      url: `${clientUrl}/properties?modelType=full`,
    })).filter(p => !p.inactive);
    // all room types
    const categories = [];
    await Promise.each(allProperties, async property => {
      let currentResults = new Array(100).fill({});
      let offset = 0;
      while (currentResults.length === 100) {
        currentResults = R.pathOr([], ['data'], await this._cacheAxios({
          forceRefresh,
          axios,
          ttl: 60 * 60 * 24 * 7, // 7 days
          method: 'get',
          url: `${clientUrl}/categories?propertyId=${property.id}&offset=${offset}&modelType=full`,
          headers,
        }));
        if (currentResults.length > 0) {
          categories.push(...currentResults);
        }
        offset += 100;
      }
    });
    const allAgentRates = R.pathOr([], ['data'], await this._cacheAxios({
      axios,
      method: 'get',
      url: `${clientUrl}/agents/${token.agentId || this.agentId}/rates`,
      headers,
    }));
    const productFields = [{
      id: 'propertyId',
      title: 'Property',
      type: 'extended-option',
      requiredForAvailability: true,
      requiredForCalendar: true,
      requiredForBooking: true,
      options: allProperties.map(property => ({
        value: property.id,
        label: property.name,
      })),
    }, {
      id: 'startDate',
      title: 'Arrival',
      type: 'date',
      requiredForAvailability: true,
      requiredForBooking: true,
    },{
      id: 'endDate',
      title: 'Departure',
      type: 'date',
      requiredForAvailability: true,
      requiredForBooking: true,
    },{
      id: 'rateId',
      title: 'Rate Type',
      type: 'extended-option',
      requiredForAvailability: true,
      requiredForBooking: true,
      filterableBy: 'propertyId',
      options: allAgentRates.map(rate => ({
        value: rate.rateId,
        label: rate.rateName,
        propertyId: rate.propertyId,
      })),
    }, {
      id: 'categoryId',
      title: 'Room Type',
      type: 'extended-option',
      requiredForAvailability: true,
      requiredForCalendar: true,
      requiredForBooking: true,
      filterableBy: 'propertyId',
      options: categories.filter(p => !p.inactive).map(category => ({
        value: category.id,
        label: category.name,
        propertyId: category.propertyId,
      })),
    }, {
      id: 'adults',
      title: 'Adults',
      type: 'count',
      requiredForBooking: true,
    }, {
      id: 'children',
      title: 'Children',
      type: 'count',
      requiredForBooking: true,
    }, {
      id: 'infants',
      title: 'Infants',
      type: 'count',
      requiredForBooking: true,
    }];
    await this.cache.save({
      key: {
        ...token,
        type: 'productFields',
      },
      value: productFields,
    });
    return {
      productFields,
    };
  }
  async createBooking({
    axios,
    token,
    payload: {
      rebookingId,
      availabilityKey,
      holder,
      notes,
      reference,
      startDate,
      endDate,
      dateFormat,
      guestId,
      propertyId,
      categoryId,
      rateId,
      adults,
      children,
      infants,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    assert(availabilityKey, 'an availability code is required !');
    assert(R.path(['name'], holder), 'a holder\' first name is required');
    assert(R.path(['surname'], holder), 'a holder\' surname is required');
    const arrivalDate = moment(startDate, dateFormat).format('YYYY-MM-DD 14:00:00');
    const departureDate = moment(endDate, dateFormat).format('YYYY-MM-DD 11:00:00');
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const dataFromAvailKey = await jwt.verify(availabilityKey, this.jwtKey);
    let gId = guestId;
    let guest;
    const guestData = {
      guestGiven: holder.name,
      guestSurname: holder.surname,
      email: R.path(['emailAddress'], holder),
      mobile: R.pathOr('', ['phoneNumber'], holder),
      propertyId: dataFromAvailKey.propertyId,
    };
    if (rebookingId) {
      const oldBooking = R.pathOr({}, ['data'], await axios({
        method: 'get',
        url: `${clientUrl}/reservations/${rebookingId}`,
        headers,
      }));
      gId = oldBooking.guestId;
      // update guest in case there are changes
      guest = R.pathOr({}, ['data'], await axios({
        method: 'patch',
        url: `${clientUrl}/guests/${gId}?ignoreMandatoryFieldWarnings=true`,
        headers,
        data: guestData,
      }));
    }
    if (!gId) {
      guest = R.path(['data'], await axios({
        method: 'post',
        headers,
        url: `${clientUrl}/guests?ignoreMandatoryFieldWarnings=true`,
        data: guestData,
      }));
      gId = guest.id;
    }
    let booking = R.path(['data'], await axios({
      method: rebookingId ? 'patch' : 'post',
      headers,
      url: rebookingId
        ? `${clientUrl}/reservations/${rebookingId}?ignoreMandatoryFieldWarnings=true`
        : `${clientUrl}/reservations?ignoreMandatoryFieldWarnings=true`,
      data: {
        voucherId: reference,
        arrivalDate,
        departureDate,
        guestId: gId,
        notes,
        propertyId,
        categoryId,
        rateTypeId: rateId,
        adults: adults || 1,
        children: children || 0,
        infants: infants || 0,
      },
      headers,
    }));
    return ({
      booking: await this._translateBooking({
        axios,
        rmsBooking: {
          ...booking,
          guest,
          propertyId,
        },
        token,
        bookingTypeDefs,
        bookingQuery,
      })
    });
  }

  async searchBooking({
    axios,
    token,
    payload: {
      bookingId,
      travelDateStart,
      travelDateEnd,
      dateFormat,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const bookings = R.pathOr([], ['data'], await axios({
      method: 'post',
      url: `${clientUrl}/reservations/search?modelType=full`,
      headers,
      data: {
        ...(bookingId ? { reservationIds: [bookingId] } : {}),
        ...(travelDateStart ? { arriveFrom: moment(travelDateStart, dateFormat).format('YYYY-MM-DD 00:00:00') } : {}),
        ...(travelDateEnd ? { arriveTo: moment(travelDateEnd, dateFormat).format('YYYY-MM-DD 00:00:00') } : {}),
      },
    }));
    return {
      bookings: await Promise.map(bookings, async booking => {
        return this._translateBooking({
          axios,
          rmsBooking: booking,
          token,
          bookingTypeDefs,
          bookingQuery,
        });
      }),
    }
  }

  async cancelBooking({
    axios,
    token,
    payload: {
      bookingId,
      id,
      reason,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const booking = R.path(['data'], await axios({
      method: 'put',
      url: `${clientUrl}/reservations/${bookingId || id}/status`,
      headers,
      data: {
        status: 'cancelled',
      }
    }));
    return {
      cancellation: await this._translateBooking({
        axios,
        rmsBooking: booking,
        token,
        bookingTypeDefs,
        bookingQuery,
      }),
    }
  }
  async getAffiliates({
    axios,
    token,
  }) {
    const {
      clientUrl,
      authToken,
    } = await this._getCreds({ ...token, axios });
    const headers = getHeaders({
      authToken,
    });
    const agents = [];
    let currentResultsTA = new Array(500).fill({});
    let offsetTA = 0;
    while (currentResultsTA.length === 500) {
      currentResultsTA = R.pathOr([], ['data'], await axios({
        method: 'get',
        url: `${clientUrl}/travelAgents?limit=500&offset=${offsetTA}`,
        headers,
      }));
      if (currentResultsTA.length > 0) {
        agents.push(...currentResultsTA);
      }
      offsetTA += 500;
    }
    let currentResultsWS = new Array(500).fill({});
    let offsetWS = 0;
    while (currentResultsWS.length === 500) {
      currentResultsWS = R.pathOr([], ['data'], await axios({
        method: 'get',
        url: `${clientUrl}/wholesalers?limit=500&offset=${offsetWS}`,
        headers,
      }));
      if (currentResultsWS.length > 0) {
        agents.push(...currentResultsWS);
      }
      offsetWS += 500;
    }
    return ({
      affiliates: agents.filter(a => !a.inactive).map(a => ({
        agentId: a.id,
        name: a.name,
      })),
    });
  }

}

module.exports = Plugin;

