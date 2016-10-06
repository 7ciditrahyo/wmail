import './mailboxListItem.less'
const React = require('react')
const flux = {
  mailbox: require('../../stores/mailbox'),
  google: require('../../stores/google')
}
const { Badge, Popover, Menu, MenuItem, Divider, FontIcon } = require('material-ui')
const Colors = require('material-ui/styles/colors')
const {mailboxDispatch} = require('../../Dispatch')
const shallowCompare = require('react-addons-shallow-compare')

module.exports = React.createClass({
  displayName: 'MailboxListItem',

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
    this.isMounted = true
    this.cssElement = document.createElement('style')
    document.head.appendChild(this.cssElement)
    flux.mailbox.S.listen(this.mailboxesChanged)
  },

  componentWillUnmount () {
    this.isMounted = false
    document.head.removeChild(this.cssElement)
    flux.mailbox.S.unlisten(this.mailboxesChanged)
  },

  /* **************************************************************************/
  // Data lifecycle
  /* **************************************************************************/

  getInitialState () {
    const mailboxStore = flux.mailbox.S.getState()
    const mailbox = mailboxStore.getMailbox(this.props.mailboxId)
    return {
      mailbox: mailbox,
      isActive: mailboxStore.activeMailboxId() === this.props.mailboxId,
      popover: false,
      popoverAnchor: null
    }
  },

  mailboxesChanged (store) {
    if (this.isMounted === false) { return }
    const mailbox = store.getMailbox(this.props.mailboxId)
    this.setState({
      mailbox: mailbox,
      isActive: store.activeMailboxId() === this.props.mailboxId
    })
  },

  shouldComponentUpdate (nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState)
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
    flux.mailbox.A.changeActive(this.props.mailboxId)
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
  */
  handleClosePopover () {
    this.setState({ popover: false })
  },

  /**
  * Deletes this mailbox
  */
  handleDelete () {
    flux.mailbox.A.remove(this.props.mailboxId)
    this.setState({ popover: false })
  },

  /**
  * Opens the inspector window for this mailbox
  */
  handleInspect () {
    mailboxDispatch.openDevTools(this.props.mailboxId)
    this.setState({ popover: false })
  },

  /**
  * Reloads this mailbox
  */
  handleReload () {
    mailboxDispatch.reload(this.props.mailboxId)
    this.setState({ popover: false })
  },

  /**
  * Moves this item up
  */
  handleMoveUp () {
    flux.mailbox.A.moveUp(this.props.mailboxId)
    this.setState({ popover: false })
  },

  /**
  * Moves this item down
  */
  handleMoveDown () {
    flux.mailbox.A.moveDown(this.props.mailboxId)
    this.setState({ popover: false })
  },

  /**
  * Handles the user requesting an account reauthentication
  */
  handeReAuthenticate () {
    flux.mailbox.A.reauthenticateBrowserSession(this.props.mailboxId)
    this.setState({ popover: false })
  },

  /* **************************************************************************/
  // Rendering
  /* **************************************************************************/

  /**
  * Updates the css styles for the mailbox
  * @param mailbox: the mailbox to update for
  */
  updateCssStyles (mailbox) {
    this.cssElement.innerHTML = `
      .mailbox-list .list-item[data-id="${mailbox.id}"] .mailbox.active {
        border-color: ${mailbox.color};
      }
      .mailbox-list .list-item[data-id="${mailbox.id}"] .mailbox:hover {
        border-color: ${mailbox.color};
      }
      .mailbox-list .list-item[data-id="${mailbox.id}"] .mailbox.active:before {
        background-color: ${mailbox.color};
      }
    `
  },

  /**
  * Renders the menu items
  * @return array of jsx elements
  */
  renderMenuItems () {
    const menuItems = []
    const {isFirst, isLast} = this.props
    const {mailbox} = this.state
    if (!isFirst) {
      menuItems.push(<MenuItem
        key='moveup'
        primaryText='Move Up'
        onClick={this.handleMoveUp}
        leftIcon={<FontIcon className='material-icons'>arrow_upward</FontIcon>} />)
    }
    if (!isLast) {
      menuItems.push(<MenuItem
        key='movedown'
        primaryText='Move Down'
        onClick={this.handleMoveDown}
        leftIcon={<FontIcon className='material-icons'>arrow_downward</FontIcon>} />)
    }
    if (!isFirst || !isLast) {
      menuItems.push(<Divider key='div-0' />)
    }
    menuItems.push(
      <MenuItem
        key='delete'
        primaryText='Delete'
        onClick={this.handleDelete}
        leftIcon={<FontIcon className='material-icons'>delete</FontIcon>} />)
    if (mailbox.artificiallyPersistCookies) {
      menuItems.push(
        <MenuItem
          key='reauthenticate'
          primaryText='Re-Authenticate'
          onClick={this.handeReAuthenticate}
          leftIcon={<FontIcon className='material-icons'>lock_outline</FontIcon>} />)
    }
    menuItems.push(<Divider key='div-1' />)
    menuItems.push(
      <MenuItem
        key='reload'
        primaryText='Reload'
        onClick={this.handleReload}
        leftIcon={<FontIcon className='material-icons'>refresh</FontIcon>} />)
    menuItems.push(
      <MenuItem
        key='insepct'
        primaryText='Inspect'
        onClick={this.handleInspect}
        leftIcon={<FontIcon className='material-icons'>bug_report</FontIcon>} />)
    return menuItems
  },

  /**
  * Renders the app
  */
  render () {
    const mailbox = this.state.mailbox
    if (!mailbox) { return false }

    this.updateCssStyles(mailbox)

    // Setup the classnames
    const containerProps = {
      'className': 'mailbox' + (this.state.isActive ? ' active' : ''),
      'data-type': mailbox.type
    }
    if (mailbox.email || mailbox.name) {
      containerProps.title = [
        mailbox.email || '',
        (mailbox.name ? '(' + mailbox.name + ')' : '')
      ].join(' ')
    }

    // Generate avatar
    let innerElement
    if (mailbox.avatarURL || mailbox.hasCustomAvatar) {
      containerProps.className += ' avatar'
      if (mailbox.hasCustomAvatar) {
        innerElement = (
          <img
            className='avatar'
            src={flux.mailbox.S.getState().getAvatar(mailbox.customAvatarId)} />
        )
      } else {
        innerElement = <img className='avatar' src={mailbox.avatarURL} />
      }
    } else {
      containerProps.className += ' index'
      innerElement = <span className='index'>{this.props.index + 1}</span>
    }

    // Generate badge
    let badgeElement
    if (mailbox.showUnreadBadge && mailbox.unread) {
      badgeElement = (
        <Badge
          badgeContent={mailbox.unread}
          className='unread-badge'
          badgeStyle={{
            backgroundColor: 'rgba(238, 54, 55, 0.95)',
            color: Colors.red50
          }} />
      )
    }

    const passProps = Object.assign({}, this.props)
    delete passProps.mailboxId
    delete passProps.index
    delete passProps.isFirst
    delete passProps.isLast

    return (
      <div
        {...passProps}
        className='list-item'
        onClick={this.handleClick}
        onContextMenu={this.handleOpenPopover}
        data-id={this.state.mailbox.id}>
        <div {...containerProps}>
          {innerElement}
          {badgeElement}
        </div>
        <Popover open={this.state.popover}
          anchorEl={this.state.popoverAnchor}
          anchorOrigin={{ horizontal: 'middle', vertical: 'center' }}
          targetOrigin={{ horizontal: 'left', vertical: 'top' }}
          onRequestClose={this.handleClosePopover}>
          <Menu desktop onEscKeyDown={this.handleClosePopover}>
            {this.renderMenuItems()}
          </Menu>
        </Popover>
      </div>
    )
  }
})
