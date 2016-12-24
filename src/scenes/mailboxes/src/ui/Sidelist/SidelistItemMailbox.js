const React = require('react')
const { Badge, Popover, Menu, MenuItem, Divider, FontIcon, Avatar } = require('material-ui')
const { mailboxDispatch, navigationDispatch } = require('../../Dispatch')
const { mailboxStore, mailboxActions } = require('../../stores/mailbox')
const shallowCompare = require('react-addons-shallow-compare')
const ReactTooltip = require('react-tooltip')
const styles = require('./SidelistStyles')

module.exports = React.createClass({
  /* **************************************************************************/
  // Class
  /* **************************************************************************/

  displayName: 'SidelistItemMailbox',
  propTypes: {
    mailboxId: React.PropTypes.string.isRequired,
    index: React.PropTypes.number.isRequired,
    isFirst: React.PropTypes.bool.isRequired,
    isLast: React.PropTypes.bool.isRequired
  },

  /* **************************************************************************/
  // Lifecycle
  /* **************************************************************************/

  componentWillMount () {
    mailboxStore.listen(this.mailboxesChanged)
  },

  componentWillUnmount () {
    mailboxStore.unlisten(this.mailboxesChanged)
  },

  /* **************************************************************************/
  // Data lifecycle
  /* **************************************************************************/

  getInitialState () {
    const mailboxState = mailboxStore.getState()
    const mailbox = mailboxState.getMailbox(this.props.mailboxId)
    return {
      mailbox: mailbox,
      isActive: mailboxState.activeMailboxId() === this.props.mailboxId,
      popover: false,
      popoverAnchor: null
    }
  },

  mailboxesChanged (mailboxState) {
    const mailbox = mailboxState.getMailbox(this.props.mailboxId)
    this.setState({
      mailbox: mailbox,
      isActive: mailboxState.activeMailboxId() === this.props.mailboxId
    })
  },

  /* **************************************************************************/
  // User Interaction
  /* **************************************************************************/

  /**
  * Handles the item being clicked on
  * @param evt: the event that fired
  */
  handleClick (evt) {
    evt.preventDefault()
    if (evt.metaKey) {
      navigationDispatch.openMailboxSettings(this.props.mailboxId)
    } else {
      mailboxActions.changeActive(this.props.mailboxId)
    }
  },

  /**
  * Opens the popover
  */
  handleOpenPopover (evt) {
    evt.preventDefault()
    this.setState({ popover: true, popoverAnchor: evt.currentTarget })
  },

  /**
  * Closes the popover
  * @param evtOrFn: the fired event or a function to call on closed
  */
  handleClosePopover (evtOrFn) {
    this.setState({ popover: false })
    if (typeof (evtOrFn) === 'function') {
      setTimeout(() => { evtOrFn() }, 200)
    }
  },

  /**
  * Deletes this mailbox
  */
  handleDelete () {
    this.handleClosePopover(() => {
      mailboxActions.remove(this.props.mailboxId)
    })
  },

  /**
  * Opens the inspector window for this mailbox
  */
  handleInspect () {
    mailboxDispatch.openDevTools(this.props.mailboxId)
    this.handleClosePopover()
  },

  /**
  * Reloads this mailbox
  */
  handleReload () {
    mailboxDispatch.reload(this.props.mailboxId)
    this.handleClosePopover()
  },

  /**
  * Moves this item up
  */
  handleMoveUp () {
    this.handleClosePopover(() => {
      mailboxActions.moveUp(this.props.mailboxId)
    })
  },

  /**
  * Moves this item down
  */
  handleMoveDown () {
    this.handleClosePopover(() => {
      mailboxActions.moveDown(this.props.mailboxId)
    })
  },

  /**
  * Handles the user requesting an account reauthentication
  */
  handeReAuthenticate () {
    mailboxActions.reauthenticateBrowserSession(this.props.mailboxId)
    this.handleClosePopover()
  },

  /**
  * Handles opening the account settings
  */
  handleAccountSettings () {
    this.handleClosePopover(() => {
      navigationDispatch.openMailboxSettings(this.props.mailboxId)
    })
  },

  /* **************************************************************************/
  // Rendering
  /* **************************************************************************/

  shouldComponentUpdate (nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState)
  },

  /**
  * Renders the menu items
  * @param mailbox: the mailbox to render for
  * @param isFirst: true if this is the first item
  * @Param isLast: true if this is the last item
  * @return array of jsx elements
  */
  renderMenuItems (mailbox, isFirst, isLast) {
    const menuItems = [
      // Mailbox Info
      mailbox.email ? (
        <MenuItem
          key='info'
          primaryText={mailbox.email}
          disabled />) : undefined,

      // Ordering controls
      isFirst ? undefined : (
        <MenuItem
          key='moveup'
          primaryText='Move Up'
          onClick={this.handleMoveUp}
          leftIcon={<FontIcon className='material-icons'>arrow_upward</FontIcon>} />),
      isLast ? undefined : (
        <MenuItem
          key='movedown'
          primaryText='Move Down'
          onClick={this.handleMoveDown}
          leftIcon={<FontIcon className='material-icons'>arrow_downward</FontIcon>} />),
      isFirst && isLast ? undefined : (<Divider key='div-0' />),

      // Account Actions
      (<MenuItem
        key='delete'
        primaryText='Delete'
        onClick={this.handleDelete}
        leftIcon={<FontIcon className='material-icons'>delete</FontIcon>} />),
      (<MenuItem
        key='settings'
        primaryText='Account Settings'
        onClick={this.handleAccountSettings}
        leftIcon={<FontIcon className='material-icons'>settings</FontIcon>} />),
      !mailbox.artificiallyPersistCookies ? undefined : (
        <MenuItem
          key='reauthenticate'
          primaryText='Re-Authenticate'
          onClick={this.handeReAuthenticate}
          leftIcon={<FontIcon className='material-icons'>lock_outline</FontIcon>} />),
      (<Divider key='div-1' />),

      // Advanced Actions
      (<MenuItem
        key='reload'
        primaryText='Reload'
        onClick={this.handleReload}
        leftIcon={<FontIcon className='material-icons'>refresh</FontIcon>} />),
      (<MenuItem
        key='inspect'
        primaryText='Inspect'
        onClick={this.handleInspect}
        leftIcon={<FontIcon className='material-icons'>bug_report</FontIcon>} />)
    ].filter((item) => !!item)

    return menuItems
  },

  /**
  * Renders the avatar element
  * @param mailbox: the mailbox to render for
  * @param index: the index for the element
  * @return jsx
  */
  renderAvatar (mailbox, index) {
    let url
    let children
    let backgroundColor
    if (mailbox.hasCustomAvatar) {
      url = mailboxStore.getState().getAvatar(mailbox.customAvatarId)
      backgroundColor = 'white'
    } else if (mailbox.avatarURL) {
      url = mailbox.avatarURL
      backgroundColor = 'white'
    } else {
      children = index
      backgroundColor = mailbox.color
    }

    return (
      <Avatar
        src={url}
        size={50}
        backgroundColor={backgroundColor}
        color='white'
        draggable={false}
        style={Object.assign({ borderColor: mailbox.color }, styles.mailboxAvatar)}>
        {children}
      </Avatar>)
  },

  /**
  * Renders the badge element
  * @param mailbox: the mailbox to render for
  * @return jsx
  */
  renderBadge (mailbox) {
    if (mailbox.showUnreadBadge && mailbox.unread) {
      const badgeContent = mailbox.unread >= 1000 ? Math.floor(mailbox.unread / 1000) + 'K+' : mailbox.unread
      return (
        <Badge
          badgeContent={badgeContent}
          badgeStyle={styles.mailboxBadge}
          style={styles.mailboxBadgeContainer} />
      )
    } else {
      return undefined
    }
  },

  /**
  * Renders the active indicator
  * @param mailbox: the mailbox to render for
  * @param isActive: true if the mailbox is active
  * @return jsx
  */
  renderActiveIndicator (mailbox, isActive) {
    if (isActive) {
      return (
        <div style={Object.assign({ backgroundColor: mailbox.color }, styles.mailboxActiveIndicator)} />
      )
    } else {
      return undefined
    }
  },

  /**
  * Renders the content for the tooltip
  * @param mailbox: the mailbox to render for
  * @return jsx
  */
  renderTooltipContent (mailbox) {
    if (!mailbox.email && !mailbox.unread) { return undefined }
    const hr = '<hr style="height: 1px; border: 0; background-image: linear-gradient(to right, #bcbcbc, #fff, #bcbcbc);" />'
    return `
      <div style="text-align:left;">
        ${mailbox.email || ''}
        ${mailbox.email && mailbox.unread ? hr : ''}
        ${mailbox.unread ? `<small>${mailbox.unread} unread message${mailbox.unread > 1 ? 's' : ''}</small>` : ''}
      </div>
    `
  },

  render () {
    const { mailbox, isActive, popover, popoverAnchor } = this.state
    const { index, isFirst, isLast, style, ...passProps } = this.props
    delete passProps.mailboxId

    return (
      <div
        {...passProps}
        style={Object.assign({}, styles.itemContainer, styles.mailboxItemContainer, style)}
        onClick={this.handleClick}
        onContextMenu={this.handleOpenPopover}
        data-tip={this.renderTooltipContent(mailbox)}
        data-html>
        <ReactTooltip place='right' type='dark' effect='solid' />
        {this.renderAvatar(mailbox, index)}
        {this.renderBadge(mailbox)}
        {this.renderActiveIndicator(mailbox, isActive)}
        <Popover open={popover}
          anchorEl={popoverAnchor}
          anchorOrigin={{ horizontal: 'middle', vertical: 'center' }}
          targetOrigin={{ horizontal: 'left', vertical: 'top' }}
          onRequestClose={this.handleClosePopover}>
          <Menu desktop onEscKeyDown={this.handleClosePopover}>
            {this.renderMenuItems(mailbox, isFirst, isLast)}
          </Menu>
        </Popover>
      </div>
    )
  }
})
