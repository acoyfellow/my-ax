Feature: Root, the one conversation that is always there
  Root is an ordinary my.ax conversation. It runs the same agent with the same
  tools as every other conversation. Only its lifetime is different: one per
  owner, found by a fixed name, never deleted. Every agent can start child
  conversations, so the conversations form a tree. Root is where the tree starts.
  Tags: @must is the floor. @should is the next step. @tree needs child conversations.

  Rule: There is exactly one root per owner

    @must
    Scenario: Opening root twice gives the same conversation
      Given I have never opened root
      When I open root
      And I open root again
      Then both times I get the same conversation id
      And it is the conversation with the stable name "root"

    @must
    Scenario: Root is an ordinary conversation
      Given I open root
      Then it uses the same agent, model choice and tools as any other conversation
      And it shows in the conversation list like any other conversation

    @must
    Scenario: Another owner never sees my root
      Given two owners each open root
      Then they get two different conversation ids
      And neither can read, send to, clear or stop the other's root

  Rule: Root cannot be deleted, only cleared

    @must
    Scenario: Deleting root is refused
      Given root exists
      When I ask to delete it
      Then the request fails with code ROOT_PROTECTED
      And root still exists with its history

    @must
    Scenario: Archiving root is refused
      Given root exists
      When I ask to archive it
      Then the request fails with code ROOT_PROTECTED

    @must
    Scenario: Clearing root keeps its id
      Given root has messages
      When I clear root
      Then root has no messages
      And root keeps the same conversation id
      And the next message I send starts a fresh turn

    @must
    Scenario: Clearing is refused while a turn runs
      Given root has a running turn
      When I clear root
      Then the request fails with code TURN_RUNNING
      And no message is lost

    @must
    Scenario: Only root can be cleared this way
      Given an ordinary conversation
      When I ask to clear it through the root clear action
      Then the request fails with code NOT_ROOT

  Rule: One widget, inline or floating

    @must
    Scenario: The widget talks to root
      Given I am on any my.ax page
      Then a small widget shows root's latest reply and a composer
      And what I send goes to root

    @must
    Scenario: A failed turn shows an error
      Given root's turn fails, for example because the model has no credentials
      Then the widget shows the error text in the conversation
      And the composer is usable again

    @must
    Scenario: Popping out keeps what I typed
      Given I typed a draft in the inline widget
      When I pop the widget out to a floating window
      Then the draft is still in the composer
      And the same conversation is shown
      When I close the floating window
      Then the inline widget shows the same draft and conversation

    @must
    Scenario: The floating window is optional
      Given my browser has no Document Picture-in-Picture
      Then the pop-out control is hidden or explains it is not available
      And the inline widget works in full

    @must
    Scenario: A running turn is visible and stoppable from the widget
      Given root has a running turn
      Then the widget shows that root is working
      And a Stop control ends the turn

  Rule: Agents can start child conversations

    @must @tree
    Scenario: An agent starts a child
      Given a conversation asks to start a child with a task
      Then a new conversation exists with that conversation as its parent
      And the child starts a turn with the task
      And the parent gets the child's id at once

    @must @tree
    Scenario: The child's answer comes back
      Given a child was started with a task
      When the child ends a reply with a line that starts with "DONE:"
      Then that line arrives in the parent as a message from the child
      And it arrives once, even if the child replies again without a new DONE line

    @must @tree
    Scenario: Waiting for a child is bounded
      Given a child is still working
      When the parent waits for it
      Then the wait returns within the limit it asked for, at most 600 seconds
      And it says the child is still working if no answer came

    @must @tree
    Scenario: A child is a full conversation
      Given a child exists
      Then I can open it, read it, send to it and stop it like any other conversation
      And deleting the parent does not delete the child

    @must @tree
    Scenario: Children stay inside one owner
      Given a conversation of mine
      Then it cannot start a child under, or deliver an answer to, another owner's conversation

    @should @tree
    Scenario: The widget shows root's tree
      Given root has started children
      Then the widget lists them under root with their live turn state

  Rule: Root organizes for me, and asks before it destroys

    @should
    Scenario: Root can read everything I own
      Given I ask root what needs me
      Then it can list my conversations, jobs and notifications to answer

    @must
    Scenario: Root asks before destructive actions
      Given I ask root to clean up
      When the clean up would archive or delete a conversation, or send anything outside my.ax
      Then root asks me to confirm first
      And nothing is archived, deleted or sent until I confirm
