
from app.db.chat_models import Conversation


def is_owned(user_id: str, conversation_id: str) -> bool:
    """Placeholder for authenticated user-scoped conversation ownership."""
    concersation = Conversation.find_one(Conversation.conversation_id == conversation_id, Conversation.user_id == user_id)
    # return concersation is not None
    return True  # TODO: Remove this line after implementing ownership check


def get_conversations_by_user(user_id: str):
    """Placeholder for retrieving conversations owned by a user."""
    return Conversation.find(Conversation.user_id == user_id)