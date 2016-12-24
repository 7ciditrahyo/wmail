const React = require('react')
const { mailboxStore, mailboxActions } = require('../../stores/mailbox')
const { googleActions } = require('../../stores/google')
const { settingsStore } = require('../../stores/settings')
const { composeStore, composeActions } = require('../../stores/compose')
const {
  remote: {shell}, ipcRenderer
} = window.nativeRequire('electron')
const URL = window.nativeRequire('url')
const {mailboxDispatch, navigationDispatch} = require('../../Dispatch')
const TimerMixin = require('react-timer-mixin')
const {WebView} = require('../../Components')
const MailboxSearch = require('./MailboxSearch')
const MailboxTargetUrl = require('./MailboxTargetUrl')
const shallowCompare = require('react-addons-shallow-compare')

module.exports = React.createClass({
  displayName: 'GoogleMailboxWindow',
  mixins: [TimerMixin],
  propTypes: {
    mailboxId: React.PropTypes.string.isRequired
  },

  /* **************************************************************************/
  // Lifecycle
  /* **************************************************************************/

  componentWillMount () {
    ipcRenderer.send('prepare-webview-session', {
      partition: 'persist:' + this.props.mailboxId
    })
  },

  componentDidMount () {
    this.gmailCountPromises = {}

    // Stores
    mailboxStore.listen(this.mailboxesChanged)
    settingsStore.listen(this.settingsChanged)
    composeStore.listen(this.composeChanged)

    // Handle dispatch events
    mailboxDispatch.on('devtools', this.handleOpenDevTools)
    mailboxDispatch.on('refocus', this.handleRefocus)
    mailboxDispatch.on('reload', this.handleReload)
    mailboxDispatch.on('openMessage', this.handleOpenMessage)
    mailboxDispatch.respond('fetch-process-memory-info', this.handleFetchProcessMemoryInfo)
    mailboxDispatch.respond('get-gmail-unread-count:' + this.props.mailboxId, this.handleGetGmailUnreadCount)
    ipcRenderer.on('mailbox-window-find-start', this.handleIPCSearchStart)
    ipcRenderer.on('mailbox-window-find-next', this.handleIPCSearchNext)
    ipcRenderer.on('mailbox-window-navigate-back', this.handleIPCNavigateBack)
    ipcRenderer.on('mailbox-window-navigate-forward', this.handleIPCNavigateForward)

    // Autofocus on the first run
    if (this.state.isActive) {
      this.setTimeout(() => { this.refs.browser.focus() })
    }

    // Fire an artifical compose change in case the compose event is waiting
    this.composeChanged(composeStore.getState())
  },

  componentWillUnmount () {
    // Stores
    mailboxStore.unlisten(this.mailboxesChanged)
    settingsStore.unlisten(this.settingsChanged)
    composeStore.unlisten(this.composeChanged)

    // Handle dispatch events
    mailboxDispatch.off('devtools', this.handleOpenDevTools)
    mailboxDispatch.off('refocus', this.handleRefocus)
    mailboxDispatch.off('reload', this.handleReload)
    mailboxDispatch.off('openMessage', this.handleOpenMessage)
    mailboxDispatch.unrespond('fetch-process-memory-info', this.handleFetchProcessMemoryInfo)
    mailboxDispatch.unrespond('get-gmail-unread-count:' + this.props.mailboxId, this.handleGetGmailUnreadCount)
    ipcRenderer.removeListener('mailbox-window-find-start', this.handleIPCSearchStart)
    ipcRenderer.removeListener('mailbox-window-find-next', this.handleIPCSearchNext)
    ipcRenderer.removeListener('mailbox-window-navigate-back', this.handleIPCNavigateBack)
    ipcRenderer.removeListener('mailbox-window-navigate-forward', this.handleIPCNavigateForward)
  },

  componentWillReceiveProps (nextProps) {
    if (this.props.mailboxId !== nextProps.mailboxId) {
      mailboxDispatch.unrespond('get-gmail-unread-count:' + this.props.mailboxId, this.handleGetGmailUnreadCount)
      mailboxDispatch.respond('get-gmail-unread-count:' + nextProps.mailboxId, this.handleGetGmailUnreadCount)
      ipcRenderer.send('prepare-webview-session', {
        partition: 'persist:' + nextProps.mailboxId
      })
      this.setState(this.getInitialState(nextProps))
    }
  },

  /* **************************************************************************/
  // Data lifecycle
  /* **************************************************************************/

  getInitialState (props = this.props) {
    const mailboxState = mailboxStore.getState()
    const mailbox = mailboxState.getMailbox(props.mailboxId)
    const settingState = settingsStore.getState()
    return {
      mailbox: mailbox,
      mailboxCount: mailboxState.mailboxCount(),
      isActive: mailboxState.activeMailboxId() === props.mailboxId,
      isSearching: mailboxState.isSearchingMailbox(props.mailboxId),
      browserSrc: mailbox.url,
      language: settingState.language,
      ui: settingState.ui,
      os: settingState.os,
      focusedUrl: null
    }
  },

  mailboxesChanged (mailboxState) {
    const mailbox = mailboxState.getMailbox(this.props.mailboxId)
    if (mailbox) {
      // Precompute
      const zoomChanged = this.state.mailbox.zoomFactor !== mailbox.zoomFactor
      const isSearching = mailboxState.isSearchingMailbox(this.props.mailboxId)

      // Set the state
      this.setState({
        mailbox: mailbox,
        mailboxCount: mailboxState.mailboxCount(),
        isActive: mailboxState.activeMailboxId() === this.props.mailboxId,
        isSearching: isSearching,
        browserSrc: mailbox.url
      })

      // Apply any actions
      if (zoomChanged) {
        this.refs.browser.setZoomLevel(mailbox.zoomFactor)
      }
    } else {
      this.setState({
        mailbox: null,
        mailboxCount: mailboxState.mailboxCount()
      })
    }
  },

  settingsChanged (settingsState) {
    const updates = {
      os: settingsState.os
    }

    // Not strictly the react way to do this here, but we need a point to push
    // changes down to the webview and this seems like the most sensible place
    // to do that
    if (settingsState.language !== this.state.language) {
      const prevLanguage = this.state.language
      const nextLanguage = settingsState.language

      if (prevLanguage.spellcheckerLanguage !== nextLanguage.spellcheckerLanguage || prevLanguage.secondarySpellcheckerLanguage !== nextLanguage.secondarySpellcheckerLanguage) {
        this.refs.browser.send('start-spellcheck', {
          language: nextLanguage.spellcheckerLanguage,
          secondaryLanguage: nextLanguage.secondarySpellcheckerLanguage
        })
      }

      updates.language = nextLanguage
    }

    if (settingsState.ui !== this.state.ui) {
      this.refs.browser.send('window-icons-in-screen', {
        inscreen: !settingsState.ui.sidebarEnabled && !settingsState.ui.showTitlebar && process.platform === 'darwin'
      })

      updates.ui = settingsState.ui
    }

    if (Object.keys(updates).length) {
      this.setState(updates)
    }
  },

  composeChanged (composeState) {
    // Look to see if we should dispatch a compose event down to the UI
    // We clear this directly here rather resetting state
    if (composeState.composing) {
      if (this.state.mailboxCount === 1 || composeState.targetMailbox === this.props.mailboxId) {
        this.refs.browser.send('compose-message', composeState.getMessageInfo())
        composeActions.clearCompose.defer()
      }
    }
  },

  /* **************************************************************************/
  // Dispatcher Events
  /* **************************************************************************/

  /**
  * Handles the inspector dispatch event
  * @param evt: the event that fired
  */
  handleOpenDevTools (evt) {
    if (evt.mailboxId === this.props.mailboxId) {
      this.refs.browser.openDevTools()
    }
  },

  /**
  * Handles refocusing the mailbox
  * @param evt: the event that fired
  */
  handleRefocus (evt) {
    if (evt.mailboxId === this.props.mailboxId || (!evt.mailboxId && this.state.isActive)) {
      this.setTimeout(() => { this.refs.browser.focus() })
    }
  },

  /**
  * Handles reloading the mailbox
  * @param evt: the event that fired
  */
  handleReload (evt) {
    if (evt.mailboxId === this.props.mailboxId) {
      this.refs.browser.reload()
    }
  },

  /**
  * Handles opening a new message
  * @param evt: the event that fired
  */
  handleOpenMessage (evt) {
    if (evt.mailboxId === this.props.mailboxId) {
      this.refs.browser.send('open-message', { messageId: evt.messageId, threadId: evt.threadId })
    }
  },

  /**
  * Fetches the webviews process memory info
  * @return promise
  */
  handleFetchProcessMemoryInfo () {
    return this.refs.browser.getProcessMemoryInfo().then((memoryInfo) => {
      return Promise.resolve({
        mailboxId: this.props.mailboxId,
        memoryInfo: memoryInfo
      })
    })
  },

  /**
  * Fetches the gmail unread count
  * @return promise
  */
  handleGetGmailUnreadCount () {
    return this.refs.browser.sendWithResponse('get-gmail-unread-count', {}, 1000).then((res) => {
      return Promise.resolve({ count: res.count })
    })
  },

  /* **************************************************************************/
  // Browser Events : Dispatcher
  /* **************************************************************************/

  /**
  * Dispatches browser IPC messages to the correct call
  * @param evt: the event that fired
  */
  dispatchBrowserIPCMessage (evt) {
    switch (evt.channel.type) {
      case 'unread-count-changed': this.handleWebViewUnreadCountChange(evt); break
      case 'open-settings': navigationDispatch.openSettings(); break
      case 'js-new-window': this.handleBrowserJSNewWindow(evt); break
      default: break
    }
  },

  /* **************************************************************************/
  // Browser Events
  /* **************************************************************************/

  /**
  * Handles the Browser DOM becoming ready
  */
  handleBrowserDomReady () {
    // Push the settings across
    this.refs.browser.setZoomLevel(this.state.mailbox.zoomFactor)

    // Language
    const languageSettings = this.state.language
    if (languageSettings.spellcheckerEnabled) {
      this.refs.browser.send('start-spellcheck', {
        language: languageSettings.spellcheckerLanguage,
        secondaryLanguage: languageSettings.secondarySpellcheckerLanguage
      })
    }

    // UI Fixes
    const ui = this.state.ui
    this.refs.browser.send('window-icons-in-screen', {
      inscreen: !ui.sidebarEnabled && !ui.showTitlebar && process.platform === 'darwin'
    })

    // Push the custom user content
    if (this.state.mailbox.hasCustomCSS || this.state.mailbox.hasCustomJS) {
      this.refs.browser.send('inject-custom-content', {
        css: this.state.mailbox.customCSS,
        js: this.state.mailbox.customJS
      })
    }
  },

  /**
  * Until https://github.com/electron/electron/issues/6958 is fixed we need to
  * be really agressive about setting zoom levels
  */
  handleZoomFixEvent () {
    this.refs.browser.setZoomLevel(this.state.mailbox.zoomFactor)
  },

  /* **************************************************************************/
  // Browser Events : Navigation
  /* **************************************************************************/

  /**
  * Handles the webview indicating the unread count may have changed
  * @param evt: the event that fired
  */
  handleWebViewUnreadCountChange (evt) {
    googleActions.suggestSyncMailboxUnreadCount(this.state.mailbox.id)
  },

  /**
  * Handles a browser preparing to navigate
  * @param evt: the event that fired
  */
  handleBrowserWillNavigate (evt) {
    // the lamest protection again dragging files into the window
    // but this is the only thing I could find that leaves file drag working
    if (evt.url.indexOf('file://') === 0) {
      this.setState({ browserSrc: this.state.mailbox.url })
    }
  },

  /* **************************************************************************/
  // Browser Events : New Windows
  /* **************************************************************************/

  /**
  * Handles a new window open request
  * @param evt: the event
  * @param webview: the webview element the event came from
  */
  handleBrowserOpenNewWindow (evt) {
    this.handleOpenNewWindow(evt.url)
  },

  /**
  * Handles a new JS browser window
  * @Param evt: the event that fired
  */
  handleBrowserJSNewWindow (evt) {
    this.handleOpenNewWindow(evt.channel.url)
  },

  /**
  * Opens a new url in the correct way
  * @param url: the url to open
  */
  handleOpenNewWindow (url) {
    const purl = URL.parse(url, true)
    let mode = 'external'
    if (purl.host === 'inbox.google.com') {
      mode = 'source'
    } else if (purl.host === 'mail.google.com') {
      if (purl.query.ui === '2' || purl.query.view === 'om') {
        mode = 'tab'
      } else {
        mode = 'source'
      }
    }

    switch (mode) {
      case 'external':
        shell.openExternal(url, { activate: !this.state.os.openLinksInBackground })
        break
      case 'source':
        this.setState({ browserSrc: url })
        break
      case 'tab':
        ipcRenderer.send('new-window', { partition: 'persist:' + this.props.mailboxId, url: url })
        break
    }
  },

  /* **************************************************************************/
  // Browser Events : Focus
  /* **************************************************************************/

  /**
  * Handles a browser focusing
  */
  handleBrowserFocused () {
    mailboxDispatch.focused(this.props.mailboxId)
  },

  /**
  * Handles a browser un-focusing
  */
  handleBrowserBlurred () {
    mailboxDispatch.blurred(this.props.mailboxId)
  },

  /* **************************************************************************/
  // UI Events : Search
  /* **************************************************************************/

  /**
  * Handles the search text changing
  * @param str: the search string
  */
  handleSearchChanged (str) {
    if (str.length) {
      this.refs.browser.findInPage(str)
    } else {
      this.refs.browser.stopFindInPage('clearSelection')
    }
  },

  /**
  * Handles searching for the next occurance
  */
  handleSearchNext (str) {
    if (str.length) {
      this.refs.browser.findInPage(str, { findNext: true })
    }
  },

  /**
  * Handles cancelling searching
  */
  handleSearchCancel () {
    mailboxActions.stopSearchingMailbox(this.props.mailboxId)
    this.refs.browser.stopFindInPage('clearSelection')
  },

  /* **************************************************************************/
  // IPC Events
  /* **************************************************************************/

  /**
  * Handles an ipc search start event coming in
  */
  handleIPCSearchStart () {
    if (this.state.isActive) {
      setTimeout(() => {
        this.refs.search.focus()
      })
    }
  },

  /**
  * Handles an ipc search next event coming in
  */
  handleIPCSearchNext () {
    if (this.state.isActive) {
      this.handleSearchNext(this.refs.search.searchQuery())
    }
  },

  /**
  * Handles navigating the mailbox back
  */
  handleIPCNavigateBack () {
    if (this.state.isActive) {
      this.refs.browser.navigateBack()
    }
  },

  /**
  * Handles navigating the mailbox forward
  */
  handleIPCNavigateForward () {
    if (this.state.isActive) {
      this.refs.browser.navigateForward()
    }
  },

  /* **************************************************************************/
  // Rendering
  /* **************************************************************************/

  shouldComponentUpdate (nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState)
  },

  /**
  * Renders the app
  */
  render () {
    if (!this.state.mailbox) { return false }
    const { isActive, browserSrc, focusedUrl, isSearching, mailbox } = this.state

    const className = [
      'mailbox-window',
      isActive ? 'active' : undefined
    ].filter((c) => !!c).join(' ')

    if (isActive) {
      this.setTimeout(() => { this.refs.browser.focus() })
    }

    return (
      <div className={className}>
        <WebView
          loadCommit={mailbox.zoomFactor === 1 ? undefined : this.handleZoomFixEvent}
          didGetResponseDetails={mailbox.zoomFactor === 1 ? undefined : this.handleZoomFixEvent}
          didNavigate={mailbox.zoomFactor === 1 ? undefined : this.handleZoomFixEvent}
          didNavigateInPage={mailbox.zoomFactor === 1 ? undefined : this.handleZoomFixEvent}
          ref='browser'
          preload='../platform/webviewInjection/google'
          partition={'persist:' + this.props.mailboxId}
          src={browserSrc}
          domReady={this.handleBrowserDomReady}
          ipcMessage={this.dispatchBrowserIPCMessage}
          newWindow={this.handleBrowserOpenNewWindow}
          willNavigate={(evt) => {
            if (mailbox.zoomFactor !== 1) { this.handleZoomFixEvent() }
            this.handleBrowserWillNavigate(evt)
          }}
          focus={this.handleBrowserFocused}
          blur={this.handleBrowserBlurred}
          updateTargetUrl={(evt) => this.setState({ focusedUrl: evt.url !== '' ? evt.url : null })} />
        <MailboxTargetUrl url={focusedUrl} />
        <MailboxSearch
          ref='search'
          isSearching={isSearching}
          onSearchChange={this.handleSearchChanged}
          onSearchNext={this.handleSearchNext}
          onSearchCancel={this.handleSearchCancel} />
      </div>
    )
  }
})
