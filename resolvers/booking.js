const { makeExecutableSchema } = require('@graphql-tools/schema');
const R = require('ramda');
const { graphql } = require('graphql');

const capitalize = sParam => {
  if (typeof sParam !== 'string') return '';
  const s = sParam.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};
const resolvers = {
  Query: {
    id: R.path(['id']),
    orderId: R.path(['id']),
    bookingId: R.path(['id']),
    supplierBookingId: R.path(['id']),
    status: e => capitalize(R.path(['status'], e)),
    // productId: R.path(['propertyId']),
    // productName: R.path(['availability', 'item', 'name']),
    cancellable: root => {
      if (root.status.toLowerCase() === 'cancelled') return false;
      return true;
    },
    editable: () => true,
    unitItems: () => [],
    start: R.path(['arrivalDate']),
    end: R.path(['departureDate']),
    allDay: () => false,
    bookingDate: R.path(['createdDate']),
    holder: root => ({
      name: R.path(['guest', 'guestGiven'], root),
      surname: R.path(['guest', 'guestSurname'], root),
      fullName: `${R.path(['guest', 'guestGiven'], root)} ${R.path(['guest', 'guestSurname'], root)}`,
      phoneNumber: R.path(['guest', 'mobile'], root),
      emailAddress: R.path(['guest', 'email'], root),
    }),
    notes: root => root.notes || '',
    price: () => ({}),
    // cancelPolicy: R.path(['effective_cancellation_policy', 'type']),
    // optionId: () => 'default',
    // optionName: R.path(['availability', 'item', 'name']),
    resellerReference: R.propOr('', 'voucherId'),
    // publicUrl: R.prop('confirmation_url'),
    // privateUrl: R.prop('dashboard_url'),
  },
};


const translateBooking = async ({ rootValue, typeDefs, query }) => {
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
  translateBooking,
};
