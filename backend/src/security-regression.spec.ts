/**
 * Security regression suite — negative tests for the Critical/High paths from
 * the pre-publication security audit (Mero-Bazaar-Security-Audit.pdf).
 *
 * These are service/DTO-level regression tests: each asserts that an attack
 * path is DENIED (fail-closed) after the remediation.
 */
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import { UserRole, OtpContext, ListingCategory } from '@prisma/client';

import { AuthService } from './modules/auth/auth.service';
import { RegisterDto } from './modules/auth/dto/register.dto';
import { ResetPasswordDto } from './modules/user/dto/reset_password.dto';
import { UserService } from './modules/user/user.service';
import { ReviewsService } from './modules/reviews/reviews.service';
import { OrdersService } from './modules/orders/orders.service';
import { VerificationService } from './modules/verification/verification.service';
import { MedicalService } from './modules/medical/medical.service';
import { PhoneOtpService } from './modules/otp/otp.service';
import { VehiclesService } from './modules/vehicles/vehicles.service';
import { ListingsService } from './modules/listings/listings.service';
import { assertVerifiedSeller } from './common/authz/seller-access';
import { PrismaService } from './database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SparrowSmsService } from './modules/otp/sparrow_sms.service';
import { ActivityLogService } from './modules/user/activity_log.service';
import { NotificationsService } from './modules/notifications/notifications.service';
import { PaymentVerificationService } from './modules/payments/payment-verification.service';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    ip: '203.0.113.7',
    headers: { 'user-agent': 'regression-test' },
    socket: {},
    ...overrides,
  } as any;
}

function prismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    listing: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    review: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    lead: { findMany: jest.fn() },
    medicalAndDental: { findUnique: jest.fn() },
    doctorProfile: { findUnique: jest.fn(), create: jest.fn() },
    phoneOtp: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    vendorProfile: { update: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) =>
      fn(prismaMock()),
    ),
  } as any;
}

describe('Security regression: authentication & registration', () => {
  let authService: AuthService;
  let prisma: ReturnType<typeof prismaMock>;
  let jwtService: any;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'x'.repeat(64);
    prisma = prismaMock();
    jwtService = { sign: jest.fn(() => 'signed.token'), verify: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: PhoneOtpService,
          useValue: { sendOtp: jest.fn(), verifyOtp: jest.fn() },
        },
        { provide: ActivityLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    authService = module.get(AuthService);
  });

  it('register DTO rejects privileged roles (ADMIN/DOCTOR)', async () => {
    for (const role of [UserRole.ADMIN, UserRole.DOCTOR]) {
      const dto = plainToInstance(RegisterDto, {
        email: `x${role}@example.com`,
        password: 'StrongPass1',
        role,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('register service never persists a caller-selected ADMIN role', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      role: UserRole.USER,
    });
    prisma.session.create.mockResolvedValue({ id: 's1' });

    const dto = plainToInstance(RegisterDto, {
      email: 'a@b.c',
      password: 'StrongPass1',
      role: UserRole.ADMIN,
    });
    // Bypass DTO whitelist to prove the service layer also fails closed.
    (dto as any).role = UserRole.ADMIN;

    const out = await authService.register(dto as any, mockReq());
    expect(out.user.role).not.toBe(UserRole.ADMIN);
    expect(prisma.user.create.mock.calls[0][0].data.role).not.toBe(
      UserRole.ADMIN,
    );
  });

  it('verifyLoginOtp rejects a token that is not purpose=login_2fa', async () => {
    jwtService.verify.mockResolvedValue({ sub: 'u1', purpose: 'access' });
    await expect(
      authService.verifyLoginOtp('some-token', '123456', mockReq()),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('Security regression: password reset & sessions', () => {
  let userService: UserService;
  let prisma: ReturnType<typeof prismaMock>;

  beforeEach(async () => {
    prisma = prismaMock();
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        {
          provide: PhoneOtpService,
          useValue: { sendOtp: jest.fn(), verifyOtp: jest.fn() },
        },
        { provide: ActivityLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    userService = module.get(UserService);
  });

  it('reset-password DTO rejects weak/empty passwords', async () => {
    const weak = plainToInstance(ResetPasswordDto, {
      token: 't',
      newPassword: 'abc',
    });
    const empty = plainToInstance(ResetPasswordDto, {
      token: 't',
      newPassword: '',
    });
    expect((await validate(weak)).length).toBeGreaterThan(0);
    expect((await validate(empty)).length).toBeGreaterThan(0);

    const strong = plainToInstance(ResetPasswordDto, {
      token: 't',
      newPassword: 'StrongPass1',
    });
    expect(await validate(strong)).toEqual([]);
  });

  it('password change revokes other sessions', async () => {
    const hash = await bcrypt.hash('OldPass1', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', password: hash });
    prisma.user.update.mockResolvedValue({});
    prisma.session.updateMany.mockResolvedValue({ count: 2 });

    await userService.updatePassword(
      'u1',
      { currentPassword: 'OldPass1', newPassword: 'NewPass1' } as any,
      'current-session',
    );
    const call = prisma.session.updateMany.mock.calls[0][0];
    expect(call.data.revokedAt).toBeInstanceOf(Date);
    expect(call.where.id.not).toBe('current-session');
  });

  it('phone change requires current password (step-up reauth)', async () => {
    const hash = await bcrypt.hash('OldPass1', 4);
    prisma.user.findUnique.mockResolvedValue({
      password: hash,
      phone: '9800000000',
      phoneVerifiedAt: new Date(),
    });

    await expect(
      userService.requestPhoneUpdate('u1', '9812345678'),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      userService.requestPhoneUpdate('u1', '9812345678', 'wrong-password'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('2FA disable requires step-up reauth', async () => {
    const hash = await bcrypt.hash('OldPass1', 4);
    prisma.user.findUnique.mockResolvedValue({
      password: hash,
      phone: '9800000000',
      phoneVerifiedAt: new Date(),
    });
    prisma.user.update.mockResolvedValue({});

    await expect(userService.disableTwoFactor('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('account deletion requires step-up reauth', async () => {
    const hash = await bcrypt.hash('OldPass1', 4);
    prisma.user.findUnique.mockResolvedValue({
      password: hash,
      phone: '9800000000',
      phoneVerifiedAt: new Date(),
    });

    await expect(userService.removeSelf('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('Security regression: reviews', () => {
  it('cannot review your own listing; duplicate review is rejected', async () => {
    const prisma = prismaMock();
    const module = await Test.createTestingModule({
      providers: [ReviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const reviews = module.get(ReviewsService);

    prisma.listing.findUnique.mockResolvedValue({ userId: 'u1' });
    await expect(
      reviews.create({ listingId: 'l1', rating: 5 } as any, 'u1'),
    ).rejects.toThrow(ForbiddenException);

    prisma.listing.findUnique.mockResolvedValue({ userId: 'u2' });
    prisma.review.findUnique.mockResolvedValue({ id: 'r1' });
    await expect(
      reviews.create({ listingId: 'l1', rating: 5 } as any, 'u1'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('Security regression: orders', () => {
  it('cannot reserve your own listing; per-account quota enforced', async () => {
    const prisma = prismaMock();
    const notifications = { create: jest.fn(), notifyAllAdmins: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: PaymentVerificationService, useValue: {} },
      ],
    }).compile();
    const orders = module.get(OrdersService);

    prisma.listing.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'u1',
      price: 100,
      vehicle: null,
    });
    await expect(orders.reserveListing('l1', 'u1')).rejects.toThrow(
      ConflictException,
    );

    prisma.listing.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'u2',
      price: 100,
      vehicle: null,
    });
    prisma.order.count.mockResolvedValue(5);
    await expect(orders.reserveListing('l1', 'u2')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('Security regression: verification & medical identity', () => {
  it('doctor cannot upload verification docs for another provider listing', async () => {
    const prisma = prismaMock();
    const module = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const verification = module.get(VerificationService);

    prisma.medicalAndDental.findUnique.mockResolvedValue({
      id: 'm1',
      listing: { userId: 'other-doctor' },
    });
    await expect(
      verification.upload(
        { medicalId: 'm1', filePath: '/x.jpg' } as any,
        'my-doctor',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('medical listing create rejects an NMC licence mismatch', async () => {
    const prisma = prismaMock();
    const module = await Test.createTestingModule({
      providers: [MedicalService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const medical = module.get(MedicalService);

    prisma.doctorProfile.findUnique.mockResolvedValue({
      userId: 'u1',
      nmcLicenseNumber: 'NMC-REAL-1',
      doctorName: 'Dr A',
      specialization: 'GENERAL_MEDICINE',
    });

    await expect(
      medical.create({ nmcLicenseNumber: 'NMC-FORGED-2' } as any, 'u1'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('Security regression: OTP', () => {
  it('sendOtp enforces per-phone window (no history erasure)', async () => {
    const prisma = prismaMock();
    const sparrow = { send: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        PhoneOtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: SparrowSmsService, useValue: sparrow },
      ],
    }).compile();
    const otp = module.get(PhoneOtpService);

    prisma.phoneOtp.count.mockResolvedValue(3);
    await expect(otp.sendOtp('9800000000', OtpContext.LOGIN)).rejects.toThrow();
    // The rate window is never cleared by deleting rows.
    expect(prisma.phoneOtp.deleteMany).toBeUndefined();
  });

  it('verifyOtp locks after max attempts (atomic guard)', async () => {
    const prisma = prismaMock();
    const sparrow = { send: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        PhoneOtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: SparrowSmsService, useValue: sparrow },
      ],
    }).compile();
    const otp = module.get(PhoneOtpService);

    prisma.phoneOtp.findFirst.mockResolvedValue({
      id: 'o1',
      attempts: 4,
      otpHash: 'x',
    });
    prisma.phoneOtp.updateMany.mockResolvedValue({ count: 0 }); // attempts >= 5 → locked
    await expect(
      otp.verifyOtp('9800000000', '123456', OtpContext.LOGIN),
    ).rejects.toThrow();
  });
});

describe('Security regression: seller gate & trust flags', () => {
  it('assertVerifiedSeller denies non-vendors and unverified vendors', async () => {
    const prisma = prismaMock();

    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.USER,
      vendorProfile: null,
    });
    await expect(assertVerifiedSeller(prisma, 'u1')).rejects.toThrow(
      ForbiddenException,
    );

    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.VENDOR,
      vendorProfile: { isVerified: false },
    });
    await expect(assertVerifiedSeller(prisma, 'u1')).rejects.toThrow(
      ForbiddenException,
    );

    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.VENDOR,
      vendorProfile: { isVerified: true },
    });
    await expect(assertVerifiedSeller(prisma, 'u1')).resolves.toBeUndefined();
  });

  it('generic listing create enforces the same KYC gate as the category services', async () => {
    // Regression for the bypass where POST /listings (JwtAuthGuard only) reached
    // ListingsService.create without the seller/KYC check the 8 category
    // services already applied, letting any authenticated account publish.
    const prisma = prismaMock();
    const module = await Test.createTestingModule({
      providers: [ListingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const listings = module.get(ListingsService);

    const dto = { title: 't', price: 1, category: ListingCategory.VEHICLE };

    // Plain USER - denied.
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.USER,
      vendorProfile: null,
    });
    await expect(listings.create(dto as any, 'u1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.listing.create).not.toHaveBeenCalled();

    // VENDOR whose KYC is still pending - denied.
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.VENDOR,
      vendorProfile: { isVerified: false },
    });
    await expect(listings.create(dto as any, 'u1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.listing.create).not.toHaveBeenCalled();

    // KYC-approved VENDOR - allowed.
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.VENDOR,
      vendorProfile: { isVerified: true },
    });
    prisma.listing.create.mockResolvedValue({ id: 'l1' });
    await expect(listings.create(dto as any, 'u1')).resolves.toEqual({ id: 'l1' });
    expect(prisma.listing.create).toHaveBeenCalled();
  });

  it('vehicle create downgrades self-asserted bluebook verification', async () => {
    const prisma = prismaMock();
    const module = await Test.createTestingModule({
      providers: [
        VehiclesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const vehicles = module.get(VehiclesService);

    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.VENDOR,
      vendorProfile: { isVerified: true },
    });
    prisma.listing.create.mockResolvedValue({ id: 'l1' });

    await vehicles.create(
      {
        bluebook_status: 'verified',
        type: 'car',
        brand: 'B',
        model: 'M',
        year: 2020,
        km_driven: 10,
        condition: 'used',
      } as any,
      'u1',
    );

    const created = prisma.listing.create.mock.calls[0][0].data.vehicle.create;
    expect(created.bluebook_status).toBe('pending');
  });
});
