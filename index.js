#!/usr/bin/env node

const express = require('express')
    , session = require('express-session')  // https://github.com/expressjs/session
    , MemoryStore = require('memorystore')(session) // https://github.com/roccomuso/memorystore
    , path = require('path')
    , DSAuthCodeGrant = require('./lib/DSAuthCodeGrant')
    , passport = require('passport')
    , DocusignStrategy = require('passport-docusign')
    , ds_config = require('./ds_configuration.js').config
    , dsWork = require('./lib/dsWork')
    , flash = require('express-flash')
    , helmet = require('helmet') // https://expressjs.com/en/advanced/best-practice-security.html
    , moment = require('moment')
    , csp = require('helmet-csp')
    , PORT = process.env.PORT || 5000
    , HOST = process.env.HOST || 'localhost'
    , hostUrl = 'http://' + HOST + ':' + PORT
    , max_session_min = 60
    ;

let app = express()
  .use(helmet())
  .use(express.static(path.join(__dirname, 'public')))
  .use(session({
    secret: ds_config.sessionSecret,
    name: 'ds-eg03-session',
    cookie: {maxAge: max_session_min * 60000},
    saveUninitialized: true,
    resave: true,
    store: new MemoryStore({
        checkPeriod: 86400000 // prune expired entries every 24h
  })}))
  .use(passport.initialize())
  .use(passport.session())
  .use(((req, res, next) => {res.locals.user = req.user; res.locals.session = req.session; next()})) // Send user info to views
  .use(flash())
  .use(csp({
    // Specify directives as normal.
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'", "https://code.jquery.com","https://cdnjs.cloudflare.com",
        "https://maxcdn.bootstrapcdn.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://maxcdn.bootstrapcdn.com"],
      imgSrc: ["'self'", "data:"],
      sandbox: ['allow-forms', 'allow-scripts', 'allow-modals',
        'allow-popups', 'allow-same-origin'],
      // Don't set the following
      upgradeInsecureRequests: false,
      workerSrc: false,
      fontSrc: false,
      objectSrc: false,
    },
    // This module will detect common mistakes in your directives and throw errors
    // if it finds any. To disable this, enable "loose mode".
    loose: false,
    reportOnly: false,
    setAllHeaders: false,
    // Set to true if you want to disable CSP on Android where it can be buggy.
    disableAndroid: true,
    browserSniff: true
  }))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  // Add an instance of DSAuthCodeGrant to req
  .use((req, res, next) => {req.dsAuthCodeGrant = new DSAuthCodeGrant(req); next()})
  // Routes
  .get('/', dsWork.index_controller)
  .get('/ds/login', (req, res, next) => {req.dsAuthCodeGrant.login(req, res, next)})
  .get('/ds/callback', [dsLoginCB1, dsLoginCB2]) // See below
  .get('/ds/logout', (req, res) => {req.dsAuthCodeGrant.logout(req, res)})
  .get('/ds/must_authenticate', dsWork.must_authenticate_controller)
  .get('/go', dsWork.go_controller)
  .post('/go', dsWork.go_controller)
  ;

function dsLoginCB1 (req, res, next) {req.dsAuthCodeGrant.oauth_callback1(req, res, next)}
function dsLoginCB2 (req, res, next) {req.dsAuthCodeGrant.oauth_callback2(req, res, next)}

/* Start the web server */
if (ds_config.dsClientId && ds_config.dsClientId !== '{CLIENT_ID}' &&
    ds_config.dsClientSecret && ds_config.dsClientSecret !== '{CLIENT_SECRET}') {
  app.listen(PORT, HOST, function (err) {
    if (err) {throw err}
    console.log(`Ready! Open ${hostUrl}`);
  })
} else {
  console.log(`PROBLEM: You need to set the clientId (Integrator Key), and perhaps other settings as well. 
You can set them in the source file ds_configuration.js or set environment variables.`);
}


// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.  However, since this example does not
//   have a database of user records, the complete DocuSign profile is serialized
//   and deserialized.
passport.serializeUser  (function(user, done) {done(null, user)});
passport.deserializeUser(function(obj,  done) {done(null, obj)});

// Configure passport for DocusignStrategy
passport.use(new DocusignStrategy({
    production: ds_config.production,
    clientID: ds_config.dsClientId,
    clientSecret: ds_config.dsClientSecret,
    callbackURL: hostUrl + '/ds/callback',
    state: true // automatic CSRF protection.
    // See https://github.com/jaredhanson/passport-oauth2/blob/master/lib/state/session.js
  },
  function _processDsResult(accessToken, refreshToken, params, profile, done) {
    // The params arg will be passed additional parameters of the grant.
    // See https://github.com/jaredhanson/passport-oauth2/pull/84
    //
    // Here we're just assigning the tokens to the account object
    // We store the data in DSAuthCodeGrant.loginCallback2
    let user = profile;
    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    user.expiresIn = params.expires_in;
    user.expires = moment().add(user.expiresIn, 's');
    return done(null, user);
  }
));