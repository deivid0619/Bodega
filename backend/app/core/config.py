"""Configuracion de la aplicacion, leida de variables de entorno (.env)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./bodega.db"
    secret_key: str = "cambia-esto-por-un-valor-aleatorio-largo"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    registration_code: str = "bodega"
    admin_email: str = "admin@bodega.app"
    admin_name: str = "Administrador"
    admin_password: str = "cambiar123"
    cors_origins: str = "http://localhost:5190"
    # listado publico de la tienda (Shopify) para llenar nombre, talla, foto y
    # precio de un codigo nuevo. Vacio: sin catalogo.
    catalog_url: str = "https://pigmalionmoto.com/products.json"
    # fotos de remisiones y facturas (la prueba de lo que llego y salio):
    # Supabase Storage si estan la URL del proyecto y la llave service_role
    # (solo en Render, nunca en el repositorio); si no, una carpeta local.
    # Se borran solas a los photo_days dias.
    supabase_url: str = ""
    supabase_service_key: str = ""
    photos_bucket: str = "documentos"
    photo_days: int = 60
    photos_dir: str = "fotos-documentos"
    # quien manda los avisos al celular (lo piden Google y Apple)
    vapid_subject: str = "https://pigmalionmoto.com"
    # SOLO DESARROLLO: si es true, todas las rutas se tratan como si hubiera
    # iniciado sesion el primer usuario admin, sin pedir login. Nunca poner
    # en true en produccion.
    skip_auth: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
