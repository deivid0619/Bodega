"""Tipos que usan todos los modulos."""
from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


# Las fechas se guardan en UTC. SQLite (local) las devuelve sin zona y el
# navegador las tomaria como hora de Colombia: se marcan como UTC al salir.
UtcDatetime = Annotated[datetime, AfterValidator(lambda d: d if d.tzinfo else d.replace(tzinfo=timezone.utc))]
