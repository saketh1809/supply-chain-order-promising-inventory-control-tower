import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { ExpediteReceiptDto, OverridePromiseDto, PreviewLineQueryDto, ReassignLocationDto, SplitShipmentDto } from './planner.dto';
import { PlannerService } from './planner.service';

@ApiTags('Planner actions')
@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @HttpCode(200) @Post('expedite-receipt/preview') expediteDryRun(@Body() dto: ExpediteReceiptDto) { return this.planner.expediteReceiptPreview(dto); }
  @HttpCode(200) @Post('expedite-receipt') expedite(@Body() dto: ExpediteReceiptDto, @Actor() actor: number) { return this.planner.expediteReceipt(dto, actor); }
  @HttpCode(200) @Post('reassign-location/preview') reassignDryRun(@Body() dto: PreviewLineQueryDto) { return this.planner.reassignPreview(dto.orderLineId); }
  @HttpCode(200) @Post('reassign-location') reassign(@Body() dto: ReassignLocationDto, @Actor() actor: number) { return this.planner.reassignLocation(dto, actor); }
  @HttpCode(200) @Post('override-promise') override(@Body() dto: OverridePromiseDto, @Actor() actor: number) { return this.planner.overridePromise(dto, actor); }
  @HttpCode(200) @Post('split-shipment') split(@Body() dto: SplitShipmentDto, @Actor() actor: number) { return this.planner.splitShipment(dto, actor); }
}
