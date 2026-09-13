"""Configuracion de la aplicacion, leida de variables de entorno (.env)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./bodega.db"
    secret_key: str = "cambia-esto-por-un-valor-aleatorio-largo"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    registration_code: str = "pigmalion"
    admin_email: str = "admin@pigmalionmoto.com"
    admin_name: str = "Administrador"
    admin_password: str = "cambiar123"
    cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
