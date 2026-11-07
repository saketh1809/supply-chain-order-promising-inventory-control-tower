import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import configuration from './common/config/configuration';
import { CommonModule } from './common/common.module';
import { ActorGuard } from './common/actor/actor.guard';
import { ApiExceptionFilter } from './common/api/api-exception.filter';
import { RequestLoggingInterceptor, ResponseEnvelopeInterceptor } from './common/api/api.interceptors';
import { AllocationModule } from './allocation/allocation.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { SkusModule } from './skus/skus.module';
import { LocationsModule } from './locations/locations.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { OrdersModule } from './orders/orders.module';
import { PlannerModule } from './planner/planner.module';
import { AiModule } from './ai/ai.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['.env'] }),
    CommonModule,
    AuditModule,
    ExceptionsModule,
    AllocationModule,
    SkusModule,
    LocationsModule,
    InventoryModule,
    ReceiptsModule,
    OrdersModule,
    PlannerModule,
    AiModule,
    DashboardModule,
    SettingsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer) {}
}
