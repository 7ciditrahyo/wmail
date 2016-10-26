const alt = require('../alt')
const constants = require('shared/constants')
const google = window.appNodeModulesRequire('googleapis')
const OAuth2 = google.auth.OAuth2
const credentials = require('shared/credentials')
const googleHTTP = require('./googleHTTP')
const mailboxStore = require('../mailbox/mailboxStore')
const mailboxActions = require('../mailbox/mailboxActions')
const Mailbox = require('shared/Models/Mailbox/Mailbox')
const {ipcRenderer} = window.nativeRequire('electron')
const reporter = require('../../reporter')

const cachedAuths = new Map()

class GoogleActions {

  /* **************************************************************************/
  // Pollers
  /* **************************************************************************/

  startPollingUpdates () {
    this.syncAllMailboxProfiles.defer()
    this.syncAllMailboxUnreadCounts.defer(true)

    return {
      profiles: setInterval(() => {
        this.syncAllMailboxProfiles()
      }, constants.GMAIL_PROFILE_SYNC_MS),

      unread: (() => {
        let partialCount = 0
        return setInterval(() => {
          if (partialCount >= 5) {
            this.syncAllMailboxUnreadCounts.defer(true)
            partialCount = 0
          } else {
            this.syncAllMailboxUnreadCounts.defer(false)
            partialCount++
          }
        }, constants.GMAIL_UNREAD_SYNC_MS)
      })()
    }
  }

  stopPollingUpdates () {
    return {}
  }

  /* **************************************************************************/
  // API Auth
  /* **************************************************************************/

  /**
  * Sets up the auth for a mailbox
  * @param mailboxId: the id of the mailbox to setup for
  * @return { auth, mailboxId } the mailbox auth and the mailbox id
  */
  getAPIAuth (mailboxId) {
    const mailbox = mailboxStore.getState().getMailbox(mailboxId)
    let generate = false
    if (cachedAuths.has(mailboxId)) {
      if (cachedAuths.get(mailboxId).time !== mailbox.google.authTime) {
        generate = true
      }
    } else {
      generate = true
    }

    if (generate && mailbox.google.hasAuth) {
      const auth = new OAuth2(credentials.GOOGLE_CLIENT_ID, credentials.GOOGLE_CLIENT_SECRET)
      auth.setCredentials({
        access_token: mailbox.google.accessToken,
        refresh_token: mailbox.google.refreshToken,
        expiry_date: mailbox.google.authExpiryTime
      })
      cachedAuths.set(mailbox.id, {
        time: mailbox.google.authTime,
        auth: auth
      })
    }

    return cachedAuths.get(mailboxId)
  }

  /* **************************************************************************/
  // User Auth
  /* **************************************************************************/

  /**
  * Starts the auth process for google inbox
  */
  authInboxMailbox () {
    ipcRenderer.send('auth-google', { id: Mailbox.provisionId(), type: 'ginbox' })
    return { }
  }

  /**
  * Starts the auth process for gmail
  */
  authGmailMailbox () {
    ipcRenderer.send('auth-google', { id: Mailbox.provisionId(), type: 'gmail' })
    return { }
  }

  /**
  * Handles a mailbox authenticating
  * @param evt: the event that came over the ipc
  * @param data: the data that came across the ipc
  */
  authMailboxSuccess (evt, data) {
    mailboxActions.create(data.id, {
      type: data.type,
      googleAuth: data.auth
    })
    // Run the first sync
    const mailbox = mailboxStore.getState().getMailbox(data.id)
    const firstSync = Promise.all([
      this.syncMailboxProfile(data.id).promise,
      this.syncMailboxUnreadCount(data.id).promise
    ])

    return { mailbox: mailbox, firstSync: firstSync }
  }

  /**
  * Handles a mailbox authenticating error
  * @param evt: the ipc event that fired
  * @param data: the data that came across the ipc
  */
  authMailboxFailure (evt, data) {
    if (data.errorMessage.toLowerCase().indexOf('user') === 0) {
      return { user: true, data: null }
    } else {
      // Really log wha we're getting here to try and resolve issue #2
      console.error('[AUTH ERR]', data)
      console.error(data.errorString)
      console.error(data.errorStack)
      reporter.reportError('[AUTH ERR]' + data.errorString)
      return { data: data, user: false }
    }
  }

  /* **************************************************************************/
  // Profiles
  /* **************************************************************************/

  /**
  * Syncs all profiles
  */
  syncAllMailboxProfiles () {
    const mailboxIds = mailboxStore.getState().mailboxIds()
    if (mailboxIds.length === 0) { return { promise: Promise.resolve() } }

    const promise = Promise.all(mailboxIds.map((mailboxId) => {
      return this.syncMailboxProfile(mailboxId).promise
    })).then(
      () => { this.syncAllMailboxProfilesCompeted() },
      () => { this.syncAllMailboxProfilesCompeted() }
    )
    return { promise: promise }
  }

  /**
  * Indicates that all profiles have been synced
  */
  syncAllMailboxProfilesCompeted () {
    return {}
  }

  /**
  * Syncs a mailbox profile
  * @param mailboxId: the id of the mailbox
  */
  syncMailboxProfile (mailboxId) {
    const { auth } = this.getAPIAuth(mailboxId)

    const promise = googleHTTP.fetchMailboxProfile(auth)
      .then((response) => {
        mailboxActions.setBasicProfileInfo(
          mailboxId,
          (response.response.emails.find((a) => a.type === 'account') || {}).value,
          response.response.displayName,
          response.response.image.url
        )
      })
      .then(
        (response) => this.syncMailboxProfileSuccess(mailboxId),
        (err) => this.syncMailboxProfileFailure(mailboxId, err)
      )

    return { mailboxId: mailboxId, promise: promise }
  }

  /**
  * Deals with a mailbox sync completing
  * @param mailboxId: the id of the mailbox
  */
  syncMailboxProfileSuccess (mailboxId) {
    return { mailboxId: mailboxId }
  }

  /**
  * Deals with a mailbox sync completing
  * @param mailboxId: the id of the mailbox
  * @param err: the error from the api
  */
  syncMailboxProfileFailure (mailboxId, err) {
    console.warn('[SYNC ERR] Mailbox Profile', err)
    return { mailboxId: mailboxId }
  }

  /* **************************************************************************/
  // Unread Counts
  /* **************************************************************************/

  /**
  * Syncs all profiles
  * @param forceFullSync=false: set to true to avoid the cursory check
  */
  syncAllMailboxUnreadCounts (forceFullSync = false) {
    const mailboxIds = mailboxStore.getState().mailboxIds()
    if (mailboxIds.length === 0) { return { promise: Promise.resolve() } }

    const promise = Promise.all(mailboxIds.map((mailboxId) => {
      return this.syncMailboxUnreadCount(mailboxId, forceFullSync).promise
    })).then(
      () => { this.syncAllMailboxUnreadCountsCompleted() },
      () => { this.syncAllMailboxUnreadCountsCompleted() }
    )
    return { promise: promise }
  }

  /**
  * Indicates that all profiles have been synced
  */
  syncAllMailboxUnreadCountsCompleted () {
    return {}
  }

  /**
  * Syncs the unread count for a set of mailboxes
  * @param mailboxId: the id of the mailbox
  * @param forceFullSync=false: set to true to avoid the cursory check
  */
  syncMailboxUnreadCount (mailboxId, forceFullSync = false) {
    const { auth } = this.getAPIAuth(mailboxId)

    const promise = Promise.resolve()
      .then(() => {
        // Step 1: Fetch the mailbox label to see if we should run a sync
        if (forceFullSync) { return Promise.resolve({ changed: true }) }

        const mailbox = mailboxStore.getState().getMailbox(mailboxId)
        const label = mailbox.google.unreadLabel
        const labelField = mailbox.google.unreadCountIncludesReadMessages ? 'threadsTotal' : 'threadsUnread'
        return Promise.resolve()
          .then(() => googleHTTP.fetchMailboxLabel(auth, label))
          .then((response) => {
            if (mailbox && mailbox.google.labelUnreadCount !== response[labelField]) {
              mailboxActions.setGoogleLabelUnreadCount(mailboxId, response[labelField])
              return Promise.resolve({ changed: true })
            } else {
              return Promise.resolve({ changed: false })
            }
          })
      })
      .then(({changed}) => {
        // Step 2: if we did change run a query to get the unread message count
        if (!changed) { return Promise.resolve() }

        return Promise.resolve()
          .then(() => {
            // Step 2.1: Fetch the unread email ids
            const mailbox = mailboxStore.getState().getMailbox(mailboxId)
            const unreadQuery = mailbox.google.unreadQuery
            return googleHTTP.fetchEmailIds(auth, unreadQuery)
          })
          .then(({ response, unreadMessageCount, unreadThreadCount }) => {
            // Step 2.2: Store the unread email ids and update unread counts
            const mailbox = mailboxStore.getState().getMailbox(mailboxId)
            if (mailbox.google.unreadCountIncludesReadMessages) {
              mailboxActions.setGoogleUnreadCount(mailboxId, unreadMessageCount)
            } else {
              mailboxActions.setGoogleUnreadCount(mailboxId, unreadThreadCount)
            }

            const allMessageIds = response.messages.map((item) => item.id)
            mailboxActions.setGoogleUnreadMessageIds(mailboxId, allMessageIds)
            return Promise.resolve({ messages: response.messages })
          })
          .then(({ messages }) => {
            // Step 2.3: Filter the top messages from the unread items to show notifications
            const mailbox = mailboxStore.getState().getMailbox(mailboxId)
            const fetchMessageIds = messages
              .reduce((acc, item) => {
                if (!acc.threads.has(item.threadId)) {
                  acc.filtered.push(item)
                  acc.threads.add(item.threadId)
                }
                return acc
              }, { filtered: [], threads: new Set() })
              .filtered
              .slice(0, 10)
              .filter((item) => !mailbox.google.hasMessage(item.id))
              .map((item) => item.id)

            return Promise.resolve({ fetchMessageIds: fetchMessageIds })
          })
          .then(({ fetchMessageIds }) => {
            // Step 2.4: Fetch the top messages that we've yet to see
            if (fetchMessageIds.length === 0) { return Promise.resolve() }
            return Promise.all(fetchMessageIds.map((messageId) => {
              return Promise.resolve()
                .then(() => googleHTTP.fetchEmail(auth, messageId))
                .then((response) => {
                  const message = {
                    id: response.response.id,
                    threadId: response.response.threadId,
                    historyId: response.response.historyId,
                    internalDate: response.response.internalDate,
                    snippet: response.response.snippet,
                    payload: {
                      headers: response.response.payload.headers.filter((header) => {
                        return header.name === 'Subject' || header.name === 'From' || header.name === 'To'
                      })
                    }
                  }
                  return Promise.resolve(message)
                })
            }))
            .then((messages) => {
              mailboxActions.updateGoogleMessages(mailboxId, messages)
            })
          })
      })

    return { mailboxId: mailboxId, promise: promise }
  }

  /**
  * Deals with a mailbox unread count completing
  * @param mailboxId: the id of the mailbox
  */
  syncMailboxUnreadCountSuccess (mailboxId) {
    return { mailboxId: mailboxId }
  }

  /**
  * Deals with a mailbox unread count erroring
  * @param mailboxId: the id of the mailbox
  * @param err: the error from the api
  */
  syncMailboxUnreadCountFailure (mailboxId, err) {
    console.warn('[SYNC ERR] Mailbox Unread Count', err)
    return { mailboxId: mailboxId }
  }
}

// Bind the IPC listeners
const actions = alt.createActions(GoogleActions)
ipcRenderer.on('auth-google-complete', actions.authMailboxSuccess)
ipcRenderer.on('auth-google-error', actions.authMailboxFailure)

module.exports = actions
