import { TestBed } from '@angular/core/testing';

import { AppProtectorService } from './app-protector.service';

describe('AppProtectorService', () => {
  let service: AppProtectorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AppProtectorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
