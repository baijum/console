import Cookies from 'js-cookie';
import {coFetchJSON} from '../co-fetch.js';

const loginState = () => {
  var state = Cookies.get('state');
  if (!state) {
    return null;
  }

  try {
    return JSON.parse(window.atob(state));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error.stack);
    return null;
  }
};

const loginStateItem = key => (loginState() || {})[key];


export const authSvc = {
  state: loginState,

  userID: () => loginStateItem('userID'),
  name: () => loginStateItem('name'),
  email: () => loginStateItem('email'),

  logout: (prev) => {
    var url = window.SERVER_FLAGS.loginURL;
    return coFetchJSON.post(window.SERVER_FLAGS.logoutURL)
      .then(() => {
        if (prev) {
          url += `?prev=${prev}`;
        }
        window.location.href = url;
      })
      .catch(() => {
        window.location.href = `${window.SERVER_FLAGS.loginErrorURL}?error_type=auth&error=logout_error`;
      });
  },

  // Infer user is logged-in by presence of valid state cookie.
  isLoggedIn: () => {
    var state = loginState();
    return !!state;
  },
};